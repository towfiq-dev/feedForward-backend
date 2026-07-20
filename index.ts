import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
  Collection,
  Filter,
  MongoClient,
  ObjectId,
  ServerApiVersion,
  Sort,
} from "mongodb";

const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

dotenv.config();

const app = express();

const port = Number(process.env.PORT) || 5000;
const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB_NAME;

const betterAuthUrl = (
  process.env.BETTER_AUTH_URL ||
  process.env.CLIENT_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");

if (!mongoUri) {
  console.error("Error: MONGODB_URI is not defined in the .env file!");

  process.exit(1);
}

if (!databaseName) {
  console.error("Error: MONGODB_DB_NAME is not defined in the .env file!");

  process.exit(1);
}

/* =========================================================
   Express middleware
========================================================= */

app.use(
  cors({
    origin: process.env.CLIENT_URL || true,
    credentials: true,
  }),
);

app.use(
  express.json({
    limit: "1mb",
  }),
);

app.use(
  express.urlencoded({
    extended: true,
  }),
);

/* =========================================================
   Food types
========================================================= */

interface FoodDocument {
  _id?: ObjectId;

  foodName: string;
  category: string;
  shortDescription: string;
  fullDescription: string;
  location: string;
  ownerName: string;
  imageUrl: string;

  expiryDate: string;
  preparationDate: string | null;

  servingSize: string;
  contactNumber: string;
  isHalal: boolean;

  userId: string;
  userEmail: string;

  status: string;
  views: number;
  requests: number;

  createdAt: string;
  updatedAt: string;
}

/* =========================================================
   Food request types
========================================================= */

type FoodRequestStatus = "pending" | "approved" | "rejected";

interface FoodRequestDocument {
  _id?: ObjectId;

  foodId: ObjectId;
  foodName: string;
  foodImageUrl: string;
  foodCategory: string;
  foodExpiryDate: string;

  /*
    Snapshot fields used by My Requests and Incoming Requests.
  */
  foodShortDescription: string;
  foodLocation: string;
  foodIsHalal: boolean;
  foodOwnerContactNumber: string;

  foodOwnerId: string;
  foodOwnerName: string;
  foodOwnerEmail: string;

  requesterUserId: string;
  requesterName: string;
  requesterEmail: string;

  phoneNumber: string;
  address: string;
  requestDescription: string;
  neededDate: string;

  status: FoodRequestStatus;

  /*
    These values are filled after the owner approves or rejects.
  */
  ownerPickupLocation: string | null;
  ownerContactNumber: string | null;
  ownerMessage: string | null;
  rejectionReason: string | null;
  decisionDate: string | null;

  requestDate: string;
  updatedAt: string;
}

interface AuthenticatedRequest extends Request {
  userId?: string;
  userName?: string;
  userEmail?: string;
}

/* =========================================================
   MongoDB configuration
========================================================= */

const mongoClient = new MongoClient(mongoUri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: false,
    deprecationErrors: true,
  },
});

let foodsCollection: Collection<FoodDocument>;

let foodRequestsCollection: Collection<FoodRequestDocument>;

let usersCollection: Collection;

let databaseConnectionPromise: Promise<void> | null = null;
let isDatabaseReady = false;

/* =========================================================
   Better Auth JWT/JWKS configuration
========================================================= */

const jwksUrl = new URL(`${betterAuthUrl}/api/auth/jwks`);

const jwks = createRemoteJWKSet(jwksUrl);

/* =========================================================
   General helper functions
========================================================= */

const ITEMS_PER_PAGE = 12;
const RELATED_ITEMS_PER_PAGE = 8;

const SORT_OPTIONS: Record<string, Sort> = {
  newest: {
    createdAt: -1,
    _id: -1,
  },

  oldest: {
    createdAt: 1,
    _id: 1,
  },

  expirySoon: {
    expiryDate: 1,
    _id: 1,
  },

  expiryLate: {
    expiryDate: -1,
    _id: -1,
  },

  nameAscending: {
    foodName: 1,
    _id: 1,
  },

  nameDescending: {
    foodName: -1,
    _id: -1,
  },

  categoryAscending: {
    category: 1,
    foodName: 1,
    _id: 1,
  },

  locationAscending: {
    location: 1,
    foodName: 1,
    _id: 1,
  },
};

const getStringValue = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

const escapeRegex = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const parsePositiveInteger = (value: unknown, fallback: number): number => {
  const stringValue = getStringValue(value);

  const parsedValue = Number.parseInt(stringValue, 10);

  if (Number.isNaN(parsedValue) || parsedValue < 1) {
    return fallback;
  }

  return parsedValue;
};

const parseBooleanValue = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();

    return (
      normalizedValue === "true" ||
      normalizedValue === "yes" ||
      normalizedValue === "1"
    );
  }

  return false;
};

const validateDateString = (value: unknown): string | null => {
  const dateValue = getStringValue(value);

  if (!dateValue) {
    return null;
  }

  const parsedDate = new Date(dateValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return dateValue;
};

const parseDateOnly = (value: string): Date | null => {
  const datePart = value.slice(0, 10);

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);

  if (!dateMatch) {
    return null;
  }

  const year = Number(dateMatch[1]);

  const month = Number(dateMatch[2]);

  const day = Number(dateMatch[3]);

  const parsedDate = new Date(year, month - 1, day);

  if (
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return null;
  }

  parsedDate.setHours(0, 0, 0, 0);

  return parsedDate;
};

const cleanFilterOptions = (values: unknown[]): string[] => {
  const cleanedValues = values
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    .map((value) => value.trim());

  return [...new Set(cleanedValues)].sort((firstValue, secondValue) =>
    firstValue.localeCompare(secondValue, undefined, {
      sensitivity: "base",
    }),
  );
};

const formatFoodDocument = (food: FoodDocument) => {
  return {
    ...food,
    _id: food._id?.toString(),
  };
};

const formatFoodRequestDocument = (
  foodRequest: FoodRequestDocument,
  food?: FoodDocument | null,
) => {
  return {
    ...foodRequest,

    _id: foodRequest._id?.toString(),

    foodId: foodRequest.foodId.toString(),

    /*
      Fallbacks keep older request documents usable.
    */
    foodShortDescription:
      foodRequest.foodShortDescription || food?.shortDescription || "",

    foodLocation: foodRequest.foodLocation || food?.location || "",

    foodIsHalal:
      typeof foodRequest.foodIsHalal === "boolean"
        ? foodRequest.foodIsHalal
        : Boolean(food?.isHalal),

    foodOwnerContactNumber:
      foodRequest.foodOwnerContactNumber || food?.contactNumber || "",

    foodStatus:
      food?.status ||
      (foodRequest.status === "approved" ? "booked" : "unknown"),

    ownerPickupLocation: foodRequest.ownerPickupLocation || null,

    ownerContactNumber: foodRequest.ownerContactNumber || null,

    ownerMessage: foodRequest.ownerMessage || null,

    rejectionReason: foodRequest.rejectionReason || null,

    decisionDate: foodRequest.decisionDate || null,
  };
};

const getFoodMapForRequests = async (
  requests: FoodRequestDocument[],
): Promise<Map<string, FoodDocument>> => {
  const uniqueFoodIds = [
    ...new Set(requests.map((foodRequest) => foodRequest.foodId.toString())),
  ];

  if (uniqueFoodIds.length === 0) {
    return new Map<string, FoodDocument>();
  }

  const foods = await foodsCollection
    .find({
      _id: {
        $in: uniqueFoodIds.map((foodId) => new ObjectId(foodId)),
      },
    })
    .toArray();

  return new Map(
    foods
      .filter((food): food is FoodDocument & { _id: ObjectId } =>
        Boolean(food._id),
      )
      .map((food) => [food._id.toString(), food]),
  );
};

const databaseIsReady = (res: Response): boolean => {
  if (!foodsCollection) {
    res.status(503).json({
      success: false,
      message: "Database is not connected yet",
    });

    return false;
  }

  return true;
};

const requestDatabaseIsReady = (res: Response): boolean => {
  if (!foodsCollection || !foodRequestsCollection) {
    res.status(503).json({
      success: false,
      message: "Database collections are not connected yet",
    });

    return false;
  }

  return true;
};

/* =========================================================
   JWT verification middleware
========================================================= */

const verifyToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  const authorizationHeader = req.headers.authorization;

  if (!authorizationHeader) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized access",
    });
  }

  const [authorizationType, token] = authorizationHeader.split(" ");

  if (authorizationType !== "Bearer" || !token) {
    return res.status(401).json({
      success: false,
      message: "A valid Bearer token is required",
    });
  }

  try {
    const { payload } = await jwtVerify(token, jwks);

    const authenticatedUserId = payload.sub || payload.id;

    if (typeof authenticatedUserId !== "string" || !authenticatedUserId) {
      return res.status(403).json({
        success: false,
        message: "The token does not contain a valid user ID",
      });
    }

    req.userId = authenticatedUserId;

    req.userName = typeof payload.name === "string" ? payload.name : undefined;

    req.userEmail =
      typeof payload.email === "string" ? payload.email : undefined;

    next();
  } catch (error) {
    console.error("JWT verification error:", error);

    return res.status(403).json({
      success: false,
      message: "Forbidden: invalid or expired token",
    });
  }
};

/* =========================================================
  Database connection
========================================================= */

const connectDatabase = async (): Promise<void> => {
  if (isDatabaseReady) {
    return;
  }

  if (!databaseConnectionPromise) {
    databaseConnectionPromise = (async () => {
    await mongoClient.connect();

    const database = mongoClient.db(databaseName);

    foodsCollection = database.collection<FoodDocument>("foods");

    foodRequestsCollection =
      database.collection<FoodRequestDocument>("food-requests");

    usersCollection = database.collection("user");

    /* =====================
        Food indexes
      ===================== */

    await foodsCollection.createIndex({
      foodName: 1,
    });

    await foodsCollection.createIndex({
      category: 1,
    });

    await foodsCollection.createIndex({
      location: 1,
    });

    await foodsCollection.createIndex({
      userId: 1,
    });

    await foodsCollection.createIndex({
      status: 1,
    });

    await foodsCollection.createIndex({
      expiryDate: 1,
    });

    await foodsCollection.createIndex({
      createdAt: -1,
    });

    await foodsCollection.createIndex({
      status: 1,
      createdAt: -1,
    });

    await foodsCollection.createIndex({
      status: 1,
      category: 1,
    });

    await foodsCollection.createIndex({
      status: 1,
      location: 1,
    });

    await foodsCollection.createIndex({
      status: 1,
      expiryDate: 1,
    });

    await foodsCollection.createIndex({
      userId: 1,
      createdAt: -1,
    });

    /* =====================
         Food request indexes
      ===================== */

    /*
        Prevent the same user from
        requesting the same food twice.
      */
    await foodRequestsCollection.createIndex(
      {
        foodId: 1,
        requesterUserId: 1,
      },
      {
        unique: true,
      },
    );

    await foodRequestsCollection.createIndex({
      requesterUserId: 1,
      requestDate: -1,
    });

    await foodRequestsCollection.createIndex({
      foodOwnerId: 1,
      status: 1,
      requestDate: -1,
    });

    await foodRequestsCollection.createIndex({
      foodId: 1,
      status: 1,
    });

    await foodRequestsCollection.createIndex({
      status: 1,
      requestDate: -1,
    });

    await foodRequestsCollection.createIndex({
      foodOwnerId: 1,
      requestDate: -1,
    });

    await foodRequestsCollection.createIndex({
      requesterUserId: 1,
      status: 1,
      requestDate: -1,
    });

    console.log("Successfully connected to MongoDB!");

    console.log("Foods collection and indexes are ready!");

    console.log("Food requests collection and indexes are ready!");

    isDatabaseReady = true;
    })().catch((error) => {
      databaseConnectionPromise = null;
      isDatabaseReady = false;

      throw error;
    });
  }

  await databaseConnectionPromise;
};

/* =========================================================
   Health-check route
========================================================= */

app.get("/", (_req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    message: "ShareBite Server is running smoothly!",
  });
});

/* =========================================================
   Ensure MongoDB is connected before every API request
========================================================= */

app.use(
  "/api",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await connectDatabase();

      next();
    } catch (error) {
      console.error("MongoDB connection error:", error);

      return res.status(503).json({
        success: false,
        message: "Unable to connect to the database",
        error:
          process.env.NODE_ENV === "development" && error instanceof Error
            ? error.message
            : undefined,
      });
    }
  },
);

/* =========================================================
   GET: Current user's shared foods
========================================================= */

app.get(
  "/api/my-shared-foods/:userId",
  verifyToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!databaseIsReady(res)) {
        return;
      }

      const requestedUserId = getStringValue(req.params.userId);

      const authenticatedUserId = req.userId;

      if (!authenticatedUserId || requestedUserId !== authenticatedUserId) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to view these food items",
        });
      }

      const userFoods = await foodsCollection
        .find({
          userId: authenticatedUserId,
        })
        .sort({
          createdAt: -1,
          _id: -1,
        })
        .toArray();

      const formattedFoods = userFoods.map(formatFoodDocument);

      return res.status(200).json(formattedFoods);
    } catch (error) {
      console.error("Error fetching shared foods:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to fetch your shared foods",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/* =========================================================
   GET: Available food listing

   Query examples:

   page=1
   search=biryani
   category=Biryani
   location=Dhaka
   expiryDate=2026-07-20
   sort=newest
========================================================= */

app.get("/api/foods", async (req: Request, res: Response) => {
  try {
    if (!databaseIsReady(res)) {
      return;
    }

    const search = getStringValue(req.query.search);

    const category = getStringValue(req.query.category);

    const location = getStringValue(req.query.location);

    const expiryDate = getStringValue(req.query.expiryDate);

    const requestedSort = getStringValue(req.query.sort) || "newest";

    const selectedSort = SORT_OPTIONS[requestedSort] ? requestedSort : "newest";

    const requestedPage = parsePositiveInteger(req.query.page, 1);

    const foodsQuery: Filter<FoodDocument> = {
      status: "available",
    };

    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), "i");

      foodsQuery.$or = [
        {
          foodName: searchRegex,
        },
        {
          shortDescription: searchRegex,
        },
        {
          fullDescription: searchRegex,
        },
        {
          category: searchRegex,
        },
        {
          location: searchRegex,
        },
        {
          ownerName: searchRegex,
        },
      ];
    }

    if (category) {
      foodsQuery.category = new RegExp(`^${escapeRegex(category)}$`, "i");
    }

    if (location) {
      foodsQuery.location = new RegExp(`^${escapeRegex(location)}$`, "i");
    }

    if (expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
      foodsQuery.expiryDate = new RegExp(`^${escapeRegex(expiryDate)}`);
    }

    const availableFoodsFilter: Filter<FoodDocument> = {
      status: "available",
    };

    const [totalItems, categoryValues, locationValues] = await Promise.all([
      foodsCollection.countDocuments(foodsQuery),

      foodsCollection.distinct("category", availableFoodsFilter),

      foodsCollection.distinct("location", availableFoodsFilter),
    ]);

    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

    const currentPage =
      totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);

    const skipItems = (currentPage - 1) * ITEMS_PER_PAGE;

    const foods = await foodsCollection
      .find(foodsQuery)
      .sort(SORT_OPTIONS[selectedSort])
      .skip(skipItems)
      .limit(ITEMS_PER_PAGE)
      .toArray();

    const formattedFoods = foods.map(formatFoodDocument);

    const categories = cleanFilterOptions(categoryValues);

    const locations = cleanFilterOptions(locationValues);

    return res.status(200).json({
      success: true,
      message: "Available foods retrieved successfully",

      data: formattedFoods,

      pagination: {
        currentPage,

        itemsPerPage: ITEMS_PER_PAGE,

        totalItems,
        totalPages,

        hasNextPage: currentPage < totalPages,

        hasPreviousPage: currentPage > 1,
      },

      filterOptions: {
        categories,
        locations,
      },

      appliedFilters: {
        search,
        category,
        location,
        expiryDate,
        sort: selectedSort,
      },
    });
  } catch (error) {
    console.error("Error fetching available foods:", error);

    return res.status(500).json({
      success: false,
      message: "Error fetching available foods",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});








/* =========================================================
  GET: Latest four available foods

  Public API:
  GET /api/foods/latest
========================================================= */

app.get(
  "/api/foods/latest",
  async (
    _req: Request,
    res: Response,
  ) => {
    try {
      if (!databaseIsReady(res)) {
        return;
      }

      const latestFoods =
        await foodsCollection
          .find({
            status: "available",
          })
          .sort({
            createdAt: -1,
            _id: -1,
          })
          .limit(4)
          .toArray();

      return res.status(200).json({
        success: true,
        message:
          "Latest available foods retrieved successfully",

        data: latestFoods.map(
          formatFoodDocument,
        ),

        totalItems:
          latestFoods.length,
      });
    } catch (error) {
      console.error(
        "Error fetching latest foods:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to fetch latest available foods",

        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      });
    }
  },
);











/* =========================================================
   GET: Related foods by category

   GET /api/foods/:id/related?page=1
========================================================= */

app.get("/api/foods/:id/related", async (req: Request, res: Response) => {
  try {
    if (!databaseIsReady(res)) {
      return;
    }

    const foodId = getStringValue(req.params.id);

    if (!ObjectId.isValid(foodId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid food ID",
      });
    }

    const objectFoodId = new ObjectId(foodId);

    const selectedFood = await foodsCollection.findOne({
      _id: objectFoodId,
      status: "available",
    });

    if (!selectedFood) {
      return res.status(404).json({
        success: false,
        message: "Food item was not found or is unavailable",
      });
    }

    const requestedPage = parsePositiveInteger(req.query.page, 1);

    const relatedFoodQuery: Filter<FoodDocument> = {
      _id: {
        $ne: objectFoodId,
      },

      category: selectedFood.category,

      status: "available",
    };

    const totalItems = await foodsCollection.countDocuments(relatedFoodQuery);

    const totalPages = Math.ceil(totalItems / RELATED_ITEMS_PER_PAGE);

    const currentPage =
      totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);

    const skipItems = (currentPage - 1) * RELATED_ITEMS_PER_PAGE;

    const relatedFoods = await foodsCollection
      .find(relatedFoodQuery)
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .skip(skipItems)
      .limit(RELATED_ITEMS_PER_PAGE)
      .toArray();

    return res.status(200).json({
      success: true,
      message: "Related foods retrieved successfully",

      data: relatedFoods.map(formatFoodDocument),

      pagination: {
        currentPage,

        itemsPerPage: RELATED_ITEMS_PER_PAGE,

        totalItems,
        totalPages,

        hasNextPage: currentPage < totalPages,

        hasPreviousPage: currentPage > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching related foods:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch related foods",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});







/* =========================================================
   GET: Four foods expiring soon

   GET /api/foods/expiring-soon
========================================================= */

app.get(
  "/api/foods/expiring-soon",
  async (
    _req: Request,
    res: Response
  ) => {
    try {
      if (!databaseIsReady(res)) {
        return;
      }

      const currentDate = new Date();

      /*
        expiryDate database-e string hisebe save hoy.
        MongoDB aggregation diye date-e convert kore:
        1. Available foods filter kore
        2. Already expired foods remove kore
        3. Nearest expiry first sort kore
        4. Only 4 items return kore
      */
      const expiringFoods =
        await foodsCollection
          .aggregate<FoodDocument>([
            {
              $match: {
                status: "available",
              },
            },
            {
              $addFields: {
                parsedExpiryDate: {
                  $convert: {
                    input: "$expiryDate",
                    to: "date",
                    onError: null,
                    onNull: null,
                  },
                },
              },
            },
            {
              $match: {
                parsedExpiryDate: {
                  $ne: null,
                  $gt: currentDate,
                },
              },
            },
            {
              $sort: {
                parsedExpiryDate: 1,
                _id: 1,
              },
            },
            {
              $limit: 4,
            },
            {
              $project: {
                parsedExpiryDate: 0,
              },
            },
          ])
          .toArray();

      const formattedFoods =
        expiringFoods.map(
          formatFoodDocument
        );

      return res.status(200).json({
        success: true,
        message:
          "Foods expiring soon retrieved successfully",
        data: formattedFoods,
        totalItems: formattedFoods.length,
      });
    } catch (error) {
      console.error(
        "Error fetching foods expiring soon:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to fetch foods expiring soon",
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      });
    }
  }
);











/* =========================================================
   GET: Get one available food by ID

   Successful request increases view count.
========================================================= */

app.get("/api/foods/:id", async (req: Request, res: Response) => {
  try {
    if (!databaseIsReady(res)) {
      return;
    }

    const foodId = getStringValue(req.params.id);

    if (!ObjectId.isValid(foodId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid food ID",
      });
    }

    const objectFoodId = new ObjectId(foodId);

    const food = await foodsCollection.findOne({
      _id: objectFoodId,
      status: "available",
    });

    if (!food) {
      return res.status(404).json({
        success: false,
        message: "Food item was not found or is unavailable",
      });
    }

    await foodsCollection.updateOne(
      {
        _id: objectFoodId,
      },
      {
        $inc: {
          views: 1,
        },
      },
    );

    const updatedFood = await foodsCollection.findOne({
      _id: objectFoodId,
    });

    if (!updatedFood) {
      return res.status(404).json({
        success: false,
        message: "Food item could not be found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Food details retrieved successfully",

      data: formatFoodDocument(updatedFood),
    });
  } catch (error) {
    console.error("Error fetching food details:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch food details",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/* =========================================================
   POST: Share a new food
========================================================= */

app.post(
  "/api/food-share",
  verifyToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!databaseIsReady(res)) {
        return;
      }

      const authenticatedUserId = req.userId;

      if (!authenticatedUserId) {
        return res.status(401).json({
          success: false,
          message: "Authenticated user information was not found",
        });
      }

      const foodName = getStringValue(req.body.foodName);

      const category = getStringValue(req.body.category);

      const shortDescription = getStringValue(req.body.shortDescription);

      const fullDescription = getStringValue(req.body.fullDescription);

      const location = getStringValue(req.body.location);

      const ownerName = getStringValue(req.body.ownerName);

      const imageUrl = getStringValue(req.body.imageUrl);

      const servingSize = getStringValue(req.body.servingSize);

      const contactNumber = getStringValue(req.body.contactNumber);

      const expiryDate = validateDateString(req.body.expiryDate);

      const rawPreparationDate = getStringValue(req.body.preparationDate);

      const preparationDate = rawPreparationDate
        ? validateDateString(rawPreparationDate)
        : null;

      const isHalal = parseBooleanValue(req.body.isHalal);

      if (!foodName) {
        return res.status(400).json({
          success: false,
          message: "Food name is required",
        });
      }

      if (!category) {
        return res.status(400).json({
          success: false,
          message: "Category is required",
        });
      }

      if (!shortDescription) {
        return res.status(400).json({
          success: false,
          message: "Short description is required",
        });
      }

      if (shortDescription.length > 100) {
        return res.status(400).json({
          success: false,
          message: "Short description cannot exceed 100 characters",
        });
      }

      if (!fullDescription) {
        return res.status(400).json({
          success: false,
          message: "Full description is required",
        });
      }

      if (!location) {
        return res.status(400).json({
          success: false,
          message: "Location is required",
        });
      }

      if (!ownerName) {
        return res.status(400).json({
          success: false,
          message: "Owner name is required",
        });
      }

      if (!expiryDate) {
        return res.status(400).json({
          success: false,
          message: "A valid expiry date is required",
        });
      }

      if (rawPreparationDate && !preparationDate) {
        return res.status(400).json({
          success: false,
          message: "Preparation date is invalid",
        });
      }

      const currentDate = new Date().toISOString();

      const foodDocument: FoodDocument = {
        foodName,
        category,
        shortDescription,
        fullDescription,
        location,
        ownerName,
        imageUrl,
        expiryDate,
        preparationDate,
        servingSize,
        contactNumber,
        isHalal,

        userId: authenticatedUserId,

        userEmail: req.userEmail || "",

        status: "available",

        views: 0,
        requests: 0,

        createdAt: currentDate,

        updatedAt: currentDate,
      };

      const result = await foodsCollection.insertOne(foodDocument);

      return res.status(201).json({
        success: true,
        message: "Food shared successfully!",

        data: {
          ...foodDocument,

          _id: result.insertedId.toString(),

          id: result.insertedId.toString(),
        },
      });
    } catch (error) {
      console.error("Error sharing food:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to share food",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/* =========================================================
   PATCH: Update food
========================================================= */

app.patch(
  "/api/foods/:id",
  verifyToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!databaseIsReady(res)) {
        return;
      }

      const foodId = getStringValue(req.params.id);

      const authenticatedUserId = req.userId;

      if (!authenticatedUserId) {
        return res.status(401).json({
          success: false,
          message: "Authenticated user information was not found",
        });
      }

      if (!ObjectId.isValid(foodId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid food ID",
        });
      }

      const objectFoodId = new ObjectId(foodId);

      const existingFood = await foodsCollection.findOne({
        _id: objectFoodId,
      });

      if (!existingFood) {
        return res.status(404).json({
          success: false,
          message: "Food not found",
        });
      }

      if (existingFood.userId !== authenticatedUserId) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to update this food item",
        });
      }

      const updateData: Partial<FoodDocument> = {};

      if (req.body.foodName !== undefined) {
        const foodName = getStringValue(req.body.foodName);

        if (!foodName) {
          return res.status(400).json({
            success: false,
            message: "Food name cannot be empty",
          });
        }

        updateData.foodName = foodName;
      }

      if (req.body.category !== undefined) {
        const category = getStringValue(req.body.category);

        if (!category) {
          return res.status(400).json({
            success: false,
            message: "Category cannot be empty",
          });
        }

        updateData.category = category;
      }

      if (req.body.shortDescription !== undefined) {
        const shortDescription = getStringValue(req.body.shortDescription);

        if (!shortDescription) {
          return res.status(400).json({
            success: false,
            message: "Short description cannot be empty",
          });
        }

        if (shortDescription.length > 100) {
          return res.status(400).json({
            success: false,
            message: "Short description cannot exceed 100 characters",
          });
        }

        updateData.shortDescription = shortDescription;
      }

      if (req.body.fullDescription !== undefined) {
        const fullDescription = getStringValue(req.body.fullDescription);

        if (!fullDescription) {
          return res.status(400).json({
            success: false,
            message: "Full description cannot be empty",
          });
        }

        updateData.fullDescription = fullDescription;
      }

      if (req.body.location !== undefined) {
        const location = getStringValue(req.body.location);

        if (!location) {
          return res.status(400).json({
            success: false,
            message: "Location cannot be empty",
          });
        }

        updateData.location = location;
      }

      if (req.body.ownerName !== undefined) {
        const ownerName = getStringValue(req.body.ownerName);

        if (!ownerName) {
          return res.status(400).json({
            success: false,
            message: "Owner name cannot be empty",
          });
        }

        updateData.ownerName = ownerName;
      }

      if (req.body.imageUrl !== undefined) {
        updateData.imageUrl = getStringValue(req.body.imageUrl);
      }

      if (req.body.servingSize !== undefined) {
        updateData.servingSize = getStringValue(req.body.servingSize);
      }

      if (req.body.contactNumber !== undefined) {
        updateData.contactNumber = getStringValue(req.body.contactNumber);
      }

      if (req.body.expiryDate !== undefined) {
        const expiryDate = validateDateString(req.body.expiryDate);

        if (!expiryDate) {
          return res.status(400).json({
            success: false,
            message: "Expiry date is invalid",
          });
        }

        updateData.expiryDate = expiryDate;
      }

      if (req.body.preparationDate !== undefined) {
        const rawPreparationDate = getStringValue(req.body.preparationDate);

        if (!rawPreparationDate) {
          updateData.preparationDate = null;
        } else {
          const preparationDate = validateDateString(rawPreparationDate);

          if (!preparationDate) {
            return res.status(400).json({
              success: false,
              message: "Preparation date is invalid",
            });
          }

          updateData.preparationDate = preparationDate;
        }
      }

      if (req.body.isHalal !== undefined) {
        updateData.isHalal = parseBooleanValue(req.body.isHalal);
      }

      if (req.body.status !== undefined) {
        const requestedStatus = getStringValue(req.body.status).toLowerCase();

        const allowedStatuses = ["available", "booked", "unavailable"];

        if (!allowedStatuses.includes(requestedStatus)) {
          return res.status(400).json({
            success: false,
            message: "Invalid food status",
          });
        }

        updateData.status = requestedStatus;
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          message: "No update information was provided",
        });
      }

      updateData.updatedAt = new Date().toISOString();

      const updateResult = await foodsCollection.updateOne(
        {
          _id: objectFoodId,

          userId: authenticatedUserId,
        },
        {
          $set: updateData,
        },
      );

      if (updateResult.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Food item was not found",
        });
      }

      const updatedFood = await foodsCollection.findOne({
        _id: objectFoodId,
      });

      if (!updatedFood) {
        return res.status(404).json({
          success: false,
          message: "Updated food item could not be found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Food item updated successfully!",

        data: formatFoodDocument(updatedFood),
      });
    } catch (error) {
      console.error("Error updating food:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to update food item",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/* =========================================================
   DELETE: Delete food
========================================================= */

app.delete(
  "/api/foods/:id",
  verifyToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!databaseIsReady(res)) {
        return;
      }

      const foodId = getStringValue(req.params.id);

      const authenticatedUserId = req.userId;

      if (!authenticatedUserId) {
        return res.status(401).json({
          success: false,
          message: "Authenticated user information was not found",
        });
      }

      if (!ObjectId.isValid(foodId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid food ID",
        });
      }

      const objectFoodId = new ObjectId(foodId);

      const existingFood = await foodsCollection.findOne({
        _id: objectFoodId,
      });

      if (!existingFood) {
        return res.status(404).json({
          success: false,
          message: "Food not found",
        });
      }

      if (existingFood.userId !== authenticatedUserId) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to delete this food item",
        });
      }

      const deleteResult = await foodsCollection.deleteOne({
        _id: objectFoodId,

        userId: authenticatedUserId,
      });

      if (deleteResult.deletedCount !== 1) {
        return res.status(400).json({
          success: false,
          message: "Failed to delete the food item",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Food item deleted successfully!",
      });
    } catch (error) {
      console.error("Error deleting food:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to delete food item",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/* =========================================================
   GET: Check if user already requested a food

   GET /api/food-requests/check/:foodId
========================================================= */

app.get(
  "/api/food-requests/check/:foodId",
  verifyToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!requestDatabaseIsReady(res)) {
        return;
      }

      const foodId = getStringValue(req.params.foodId);

      const requesterUserId = req.userId;

      if (!requesterUserId) {
        return res.status(401).json({
          success: false,
          message: "Authenticated user was not found",
        });
      }

      if (!ObjectId.isValid(foodId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid food ID",
        });
      }

      const objectFoodId = new ObjectId(foodId);

      const food = await foodsCollection.findOne({
        _id: objectFoodId,
      });

      if (!food) {
        return res.status(404).json({
          success: false,
          message: "Food was not found",
        });
      }

      /*
        The food owner cannot send a request
        for their own shared food.
      */
      if (food.userId === requesterUserId) {
        return res.status(200).json({
          success: true,
          isOwner: true,
          hasRequested: false,
          message: "You are the owner of this food",
          data: null,
        });
      }

      const existingRequest = await foodRequestsCollection.findOne({
        foodId: objectFoodId,

        requesterUserId,
      });

      return res.status(200).json({
        success: true,
        isOwner: false,

        hasRequested: Boolean(existingRequest),

        data: existingRequest
          ? formatFoodRequestDocument(existingRequest)
          : null,
      });
    } catch (error) {
      console.error("Error checking food request:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to check food request",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/* =========================================================
   POST: Send food request

   POST /api/food-requests/:foodId
========================================================= */

app.post(
  "/api/food-requests/:foodId",
  verifyToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!requestDatabaseIsReady(res)) {
        return;
      }

      const foodId = getStringValue(req.params.foodId);

      const requesterUserId = req.userId;

      const requesterEmail = req.userEmail;

      if (!requesterUserId || !requesterEmail) {
        return res.status(401).json({
          success: false,
          message: "Authenticated user information was not found",
        });
      }

      if (!ObjectId.isValid(foodId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid food ID",
        });
      }

      const phoneNumber = getStringValue(req.body.phoneNumber);

      const address = getStringValue(req.body.address);

      const requestDescription = getStringValue(req.body.requestDescription);

      const neededDate = validateDateString(req.body.neededDate);

      /* =====================
         Form validation
      ===================== */

      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          message: "Phone number is required",
        });
      }

      if (phoneNumber.length < 6 || phoneNumber.length > 20) {
        return res.status(400).json({
          success: false,
          message: "Phone number must be between 6 and 20 characters",
        });
      }

      if (!address) {
        return res.status(400).json({
          success: false,
          message: "Address is required",
        });
      }

      if (address.length < 5) {
        return res.status(400).json({
          success: false,
          message: "Please provide a complete address",
        });
      }

      if (address.length > 300) {
        return res.status(400).json({
          success: false,
          message: "Address cannot exceed 300 characters",
        });
      }

      if (!requestDescription) {
        return res.status(400).json({
          success: false,
          message: "Request description is required",
        });
      }

      if (requestDescription.length < 10) {
        return res.status(400).json({
          success: false,
          message: "Request description must contain at least 10 characters",
        });
      }

      if (requestDescription.length > 1000) {
        return res.status(400).json({
          success: false,
          message: "Request description cannot exceed 1000 characters",
        });
      }

      if (!neededDate) {
        return res.status(400).json({
          success: false,
          message: "Please select when you need the food",
        });
      }

      const objectFoodId = new ObjectId(foodId);

      const food = await foodsCollection.findOne({
        _id: objectFoodId,
      });

      if (!food) {
        return res.status(404).json({
          success: false,
          message: "Food was not found",
        });
      }

      if (food.status !== "available") {
        return res.status(400).json({
          success: false,
          message: "This food is no longer available",
        });
      }

      /*
        Food owner cannot request
        their own food.
      */
      if (food.userId === requesterUserId) {
        return res.status(403).json({
          success: false,
          isOwner: true,
          message:
            "You are the owner of this food. You cannot request your own food.",
        });
      }

      const currentDate = new Date();

      const currentDateOnly = new Date(currentDate);

      currentDateOnly.setHours(0, 0, 0, 0);

      const foodExpiryDate = parseDateOnly(food.expiryDate);

      const requestedNeededDate = parseDateOnly(neededDate);

      if (!foodExpiryDate) {
        return res.status(400).json({
          success: false,
          message: "The food expiry date is invalid",
        });
      }

      if (!requestedNeededDate) {
        return res.status(400).json({
          success: false,
          message: "The needed date is invalid",
        });
      }

      /*
        Today is allowed. The food is expired
        only when its expiry date is before today.
      */
      if (foodExpiryDate.getTime() < currentDateOnly.getTime()) {
        return res.status(400).json({
          success: false,
          message: "This food has already expired",
        });
      }

      if (requestedNeededDate.getTime() < currentDateOnly.getTime()) {
        return res.status(400).json({
          success: false,
          message: "Needed date cannot be in the past",
        });
      }

      /*
        The expiry date itself is allowed.
      */
      if (requestedNeededDate.getTime() > foodExpiryDate.getTime()) {
        return res.status(400).json({
          success: false,
          message: "Needed date must be on or before the food expiry date",
        });
      }

      /*
        Friendly duplicate request check.
      */
      const previousRequest = await foodRequestsCollection.findOne({
        foodId: objectFoodId,

        requesterUserId,
      });

      if (previousRequest) {
        return res.status(409).json({
          success: false,

          alreadyRequested: true,

          message: "You already sent a request for this food",

          data: formatFoodRequestDocument(previousRequest),
        });
      }

      const requestDate = currentDate.toISOString();

      const requesterName =
        req.userName?.trim() ||
        requesterEmail.split("@")[0].trim() ||
        "ShareBite User";

      const foodRequestDocument: FoodRequestDocument = {
        foodId: objectFoodId,

        foodName: food.foodName,

        foodImageUrl: food.imageUrl || "",

        foodCategory: food.category,

        foodExpiryDate: food.expiryDate,

        foodShortDescription: food.shortDescription,

        foodLocation: food.location,

        foodIsHalal: food.isHalal,

        foodOwnerContactNumber: food.contactNumber,

        foodOwnerId: food.userId,

        foodOwnerName: food.ownerName,

        foodOwnerEmail: food.userEmail || "",

        requesterUserId,

        requesterName,

        requesterEmail,

        phoneNumber,
        address,
        requestDescription,
        neededDate,

        status: "pending",

        ownerPickupLocation: null,

        ownerContactNumber: null,

        ownerMessage: null,

        rejectionReason: null,

        decisionDate: null,

        requestDate,

        updatedAt: requestDate,
      };

      const insertResult =
        await foodRequestsCollection.insertOne(foodRequestDocument);

      /*
        Increase food request count.
      */
      await foodsCollection.updateOne(
        {
          _id: objectFoodId,
        },
        {
          $inc: {
            requests: 1,
          },

          $set: {
            updatedAt: new Date().toISOString(),
          },
        },
      );

      return res.status(201).json({
        success: true,
        message: "Food request sent successfully",

        data: {
          ...formatFoodRequestDocument(foodRequestDocument),

          _id: insertResult.insertedId.toString(),
        },
      });
    } catch (error) {
      /*
        MongoDB unique index duplicate
        request protection.
      */
      const mongoError = error as {
        code?: number;
      };

      if (mongoError.code === 11000) {
        return res.status(409).json({
          success: false,

          alreadyRequested: true,

          message: "You already sent a request for this food",
        });
      }

      console.error("Error sending food request:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to send food request",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/* =========================================================
   Food request dashboard helpers
========================================================= */

const decreaseFoodRequestCount = async (
  foodId: ObjectId,
  amount = 1,
): Promise<void> => {
  const food = await foodsCollection.findOne({
    _id: foodId,
  });

  if (!food) {
    return;
  }

  await foodsCollection.updateOne(
    {
      _id: foodId,
    },
    {
      $set: {
        requests: Math.max(0, Number(food.requests || 0) - amount),
        updatedAt: new Date().toISOString(),
      },
    },
  );
};

/* =========================================================
   GET: Current user's sent food requests

   GET /api/my-requests
========================================================= */

app.get(
  "/api/my-requests",
  verifyToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!requestDatabaseIsReady(res)) {
        return;
      }

      const requesterUserId = req.userId;

      if (!requesterUserId) {
        return res.status(401).json({
          success: false,
          message: "Authenticated user information was not found",
        });
      }

      const requests = await foodRequestsCollection
        .find({
          requesterUserId,
        })
        .sort({
          requestDate: -1,
          _id: -1,
        })
        .toArray();

      const foodMap = await getFoodMapForRequests(requests);

      const formattedRequests = requests.map((foodRequest) =>
        formatFoodRequestDocument(
          foodRequest,
          foodMap.get(foodRequest.foodId.toString()),
        ),
      );

      const statusCounts = {
        total: formattedRequests.length,
        pending: formattedRequests.filter(
          (foodRequest) => foodRequest.status === "pending",
        ).length,
        approved: formattedRequests.filter(
          (foodRequest) => foodRequest.status === "approved",
        ).length,
        rejected: formattedRequests.filter(
          (foodRequest) => foodRequest.status === "rejected",
        ).length,
      };

      return res.status(200).json({
        success: true,
        message: "Your food requests were retrieved successfully",
        data: formattedRequests,
        statusCounts,
      });
    } catch (error) {
      console.error("Error fetching my food requests:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to fetch your food requests",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/* =========================================================
   DELETE: Delete current user's request

   DELETE /api/my-requests/:requestId

   The request is removed from the food-requests collection.
   If an approved request is removed, the food remains booked.
========================================================= */

app.delete(
  "/api/my-requests/:requestId",
  verifyToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!requestDatabaseIsReady(res)) {
        return;
      }

      const requesterUserId = req.userId;

      const requestId = getStringValue(req.params.requestId);

      if (!requesterUserId) {
        return res.status(401).json({
          success: false,
          message: "Authenticated user information was not found",
        });
      }

      if (!ObjectId.isValid(requestId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid request ID",
        });
      }

      const objectRequestId = new ObjectId(requestId);

      const existingRequest = await foodRequestsCollection.findOne({
        _id: objectRequestId,
        requesterUserId,
      });

      if (!existingRequest) {
        return res.status(404).json({
          success: false,
          message: "Food request was not found",
        });
      }

      const deleteResult = await foodRequestsCollection.deleteOne({
        _id: objectRequestId,
        requesterUserId,
      });

      if (deleteResult.deletedCount !== 1) {
        return res.status(400).json({
          success: false,
          message: "The food request could not be deleted",
        });
      }

      await decreaseFoodRequestCount(existingRequest.foodId);

      return res.status(200).json({
        success: true,
        message:
          existingRequest.status === "pending"
            ? "Food request cancelled and deleted successfully"
            : "Food request deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting food request:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to delete the food request",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/* =========================================================
   GET: Requests received for the current owner's foods

   GET /api/incoming-food-requests
========================================================= */

app.get(
  "/api/incoming-food-requests",
  verifyToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!requestDatabaseIsReady(res)) {
        return;
      }

      const foodOwnerId = req.userId;

      if (!foodOwnerId) {
        return res.status(401).json({
          success: false,
          message: "Authenticated user information was not found",
        });
      }

      const requests = await foodRequestsCollection
        .find({
          foodOwnerId,
        })
        .sort({
          requestDate: -1,
          _id: -1,
        })
        .toArray();

      const foodMap = await getFoodMapForRequests(requests);

      const formattedRequests = requests.map((foodRequest) =>
        formatFoodRequestDocument(
          foodRequest,
          foodMap.get(foodRequest.foodId.toString()),
        ),
      );

      const statusCounts = {
        total: formattedRequests.length,
        pending: formattedRequests.filter(
          (foodRequest) => foodRequest.status === "pending",
        ).length,
        approved: formattedRequests.filter(
          (foodRequest) => foodRequest.status === "approved",
        ).length,
        rejected: formattedRequests.filter(
          (foodRequest) => foodRequest.status === "rejected",
        ).length,
      };

      return res.status(200).json({
        success: true,
        message: "Incoming food requests were retrieved successfully",
        data: formattedRequests,
        statusCounts,
      });
    } catch (error) {
      console.error("Error fetching incoming food requests:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to fetch incoming food requests",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

app.patch(
  "/api/incoming-food-requests/:requestId/decision",
  verifyToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!requestDatabaseIsReady(res)) {
        return;
      }

      const foodOwnerId = req.userId;

      const requestId = getStringValue(req.params.requestId);

      const decision = getStringValue(req.body.decision).toLowerCase();

      if (!foodOwnerId) {
        return res.status(401).json({
          success: false,
          message: "Authenticated user information was not found",
        });
      }

      if (!ObjectId.isValid(requestId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid request ID",
        });
      }

      if (decision !== "approved" && decision !== "rejected") {
        return res.status(400).json({
          success: false,
          message: "Decision must be either approved or rejected",
        });
      }

      const objectRequestId = new ObjectId(requestId);

      const existingRequest = await foodRequestsCollection.findOne({
        _id: objectRequestId,
        foodOwnerId,
      });

      if (!existingRequest) {
        return res.status(404).json({
          success: false,
          message: "Incoming food request was not found",
        });
      }

      if (existingRequest.status !== "pending") {
        return res.status(409).json({
          success: false,
          message: `This request is already ${existingRequest.status}`,
          data: formatFoodRequestDocument(existingRequest),
        });
      }

      const decisionDate = new Date().toISOString();

      if (decision === "rejected") {
        const rejectionReason = getStringValue(req.body.rejectionReason);

        if (rejectionReason.length < 3) {
          return res.status(400).json({
            success: false,
            message: "Please provide a rejection reason",
          });
        }

        if (rejectionReason.length > 500) {
          return res.status(400).json({
            success: false,
            message: "Rejection reason cannot exceed 500 characters",
          });
        }

        const updateResult = await foodRequestsCollection.updateOne(
          {
            _id: objectRequestId,
            foodOwnerId,
            status: "pending",
          },
          {
            $set: {
              status: "rejected",
              rejectionReason,
              ownerPickupLocation: null,
              ownerContactNumber: null,
              ownerMessage: null,
              decisionDate,
              updatedAt: decisionDate,
            },
          },
        );

        if (updateResult.matchedCount !== 1) {
          return res.status(409).json({
            success: false,
            message: "This request could not be rejected",
          });
        }

        const rejectedRequest = await foodRequestsCollection.findOne({
          _id: objectRequestId,
        });

        return res.status(200).json({
          success: true,
          message: "Food request rejected successfully",
          data: rejectedRequest
            ? formatFoodRequestDocument(rejectedRequest)
            : null,
        });
      }

      const pickupLocation = getStringValue(req.body.pickupLocation);

      const contactNumber = getStringValue(req.body.contactNumber);

      const ownerMessage = getStringValue(req.body.ownerMessage);

      if (pickupLocation.length < 5) {
        return res.status(400).json({
          success: false,
          message: "Please provide a complete pickup location",
        });
      }

      if (pickupLocation.length > 300) {
        return res.status(400).json({
          success: false,
          message: "Pickup location cannot exceed 300 characters",
        });
      }

      if (contactNumber.length < 6 || contactNumber.length > 20) {
        return res.status(400).json({
          success: false,
          message: "Contact number must be between 6 and 20 characters",
        });
      }

      if (ownerMessage.length < 3) {
        return res.status(400).json({
          success: false,
          message: "Please provide a short message for the requester",
        });
      }

      if (ownerMessage.length > 500) {
        return res.status(400).json({
          success: false,
          message: "Owner message cannot exceed 500 characters",
        });
      }

      /*
        First claim the food. Only one approval can change an
        available food into booked, preventing double approval.
      */
      const foodUpdateResult = await foodsCollection.updateOne(
        {
          _id: existingRequest.foodId,
          userId: foodOwnerId,
          status: "available",
        },
        {
          $set: {
            status: "booked",
            updatedAt: decisionDate,
          },
        },
      );

      if (foodUpdateResult.matchedCount !== 1) {
        return res.status(409).json({
          success: false,
          message:
            "This food is no longer available or another request has already been approved",
        });
      }

      const requestUpdateResult = await foodRequestsCollection.updateOne(
        {
          _id: objectRequestId,
          foodOwnerId,
          status: "pending",
        },
        {
          $set: {
            status: "approved",
            ownerPickupLocation: pickupLocation,
            ownerContactNumber: contactNumber,
            ownerMessage,
            rejectionReason: null,
            decisionDate,
            updatedAt: decisionDate,
          },
        },
      );

      if (requestUpdateResult.matchedCount !== 1) {
        /*
          Restore the food because the selected request could not
          be updated after the food was claimed.
        */
        await foodsCollection.updateOne(
          {
            _id: existingRequest.foodId,
            userId: foodOwnerId,
            status: "booked",
          },
          {
            $set: {
              status: "available",
              updatedAt: new Date().toISOString(),
            },
          },
        );

        return res.status(409).json({
          success: false,
          message: "This request could not be approved",
        });
      }

      /*
        Once one person is approved, all other pending requests
        for the same food are automatically rejected.
      */
      await foodRequestsCollection.updateMany(
        {
          foodId: existingRequest.foodId,
          _id: {
            $ne: objectRequestId,
          },
          status: "pending",
        },
        {
          $set: {
            status: "rejected",
            rejectionReason:
              "Another request was approved and this food is no longer available.",
            ownerPickupLocation: null,
            ownerContactNumber: null,
            ownerMessage: null,
            decisionDate,
            updatedAt: decisionDate,
          },
        },
      );

      const approvedRequest = await foodRequestsCollection.findOne({
        _id: objectRequestId,
      });

      return res.status(200).json({
        success: true,
        message:
          "Food request approved successfully. The food status is now booked.",
        data: approvedRequest
          ? formatFoodRequestDocument(approvedRequest)
          : null,
      });
    } catch (error) {
      console.error("Error updating food request decision:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to update the food request decision",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);


/* =========================================================
   DELETE: Owner deletes one incoming request

   DELETE /api/incoming-food-requests/:requestId

   The request is removed from the food-requests collection.
   If an approved request is removed, the food remains booked.
========================================================= */

app.delete(
  "/api/incoming-food-requests/:requestId",
  verifyToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!requestDatabaseIsReady(res)) {
        return;
      }

      const foodOwnerId = req.userId;

      const requestId = getStringValue(req.params.requestId);

      if (!foodOwnerId) {
        return res.status(401).json({
          success: false,
          message: "Authenticated user information was not found",
        });
      }

      if (!ObjectId.isValid(requestId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid request ID",
        });
      }

      const objectRequestId = new ObjectId(requestId);

      const existingRequest = await foodRequestsCollection.findOne({
        _id: objectRequestId,
        foodOwnerId,
      });

      if (!existingRequest) {
        return res.status(404).json({
          success: false,
          message: "Incoming food request was not found",
        });
      }

      const deleteResult = await foodRequestsCollection.deleteOne({
        _id: objectRequestId,
        foodOwnerId,
      });

      if (deleteResult.deletedCount !== 1) {
        return res.status(400).json({
          success: false,
          message: "The incoming request could not be deleted",
        });
      }

      await decreaseFoodRequestCount(existingRequest.foodId);

      return res.status(200).json({
        success: true,
        message: "Incoming food request deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting incoming food request:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to delete the incoming food request",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

/* =========================================================
   DELETE: Owner deletes every request for one food

   DELETE /api/incoming-food-requests/food/:foodId

   All matching documents are removed from food-requests.
   The food itself is not deleted and its status is not changed.
========================================================= */

app.delete(
  "/api/incoming-food-requests/food/:foodId",
  verifyToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!requestDatabaseIsReady(res)) {
        return;
      }

      const foodOwnerId = req.userId;

      const foodId = getStringValue(req.params.foodId);

      if (!foodOwnerId) {
        return res.status(401).json({
          success: false,
          message: "Authenticated user information was not found",
        });
      }

      if (!ObjectId.isValid(foodId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid food ID",
        });
      }

      const objectFoodId = new ObjectId(foodId);

      const food = await foodsCollection.findOne({
        _id: objectFoodId,
        userId: foodOwnerId,
      });

      if (!food) {
        return res.status(404).json({
          success: false,
          message: "Food item was not found or you are not its owner",
        });
      }

      const deleteResult = await foodRequestsCollection.deleteMany({
        foodId: objectFoodId,
        foodOwnerId,
      });

      if (deleteResult.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "No incoming requests were found for this food",
        });
      }

      await decreaseFoodRequestCount(objectFoodId, deleteResult.deletedCount);

      return res.status(200).json({
        success: true,
        message: `${deleteResult.deletedCount} food request${
          deleteResult.deletedCount === 1 ? "" : "s"
        } deleted successfully`,
        deletedCount: deleteResult.deletedCount,
      });
    } catch (error) {
      console.error("Error deleting food request group:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to delete the food request group",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);





/* =========================================================
   GET: Public community impact statistics

   GET /api/community-impact
========================================================= */

app.get(
  "/api/community-impact",
  async (
    _req: Request,
    res: Response,
  ) => {
    try {
      if (
        !foodsCollection ||
        !foodRequestsCollection ||
        !usersCollection
      ) {
        return res.status(503).json({
          success: false,
          message:
            "Database collections are not connected yet",
        });
      }

      const [
        totalFoodPosts,
        totalRequests,
        totalApproved,
        totalRejected,
        totalPending,
        totalUsers,
      ] = await Promise.all([
        /*
         * Total number of food documents.
         */
        foodsCollection.countDocuments({}),

        /*
         * Total number of food requests.
         */
        foodRequestsCollection.countDocuments(
          {},
        ),

        /*
         * Total approved requests.
         */
        foodRequestsCollection.countDocuments({
          status: "approved",
        }),

        /*
         * Total rejected requests.
         */
        foodRequestsCollection.countDocuments({
          status: "rejected",
        }),

        /*
         * Total pending requests.
         */
        foodRequestsCollection.countDocuments({
          status: "pending",
        }),

        /*
         * Better Auth users are stored
         * inside the "user" collection.
         */
        usersCollection.countDocuments({}),
      ]);

      return res.status(200).json({
        success: true,

        message:
          "Community impact statistics retrieved successfully",

        data: {
          totalFoodPosts,
          totalRequests,
          totalApproved,
          totalRejected,
          totalPending,
          totalUsers,
        },
      });
    } catch (error) {
      console.error(
        "Error fetching community impact statistics:",
        error,
      );

      return res.status(500).json({
        success: false,

        message:
          "Failed to fetch community impact statistics",

        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      });
    }
  },
);











/* =========================================================
   Route not found
========================================================= */

app.use((req: Request, res: Response) => {
  return res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

/* =========================================================
   Global Express error handler
========================================================= */

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled server error:", error);

  return res.status(500).json({
    success: false,
    message: "An unexpected server error occurred",

    error: process.env.NODE_ENV === "development" ? error.message : undefined,
  });
});

/* =========================================================
   Start server after MongoDB connects
========================================================= */

// const startServer = async () => {
//   try {
//     await connectDatabase();

//     app.listen(port, () => {
//       console.log(`ShareBite Server is running on http://localhost:${port}`);

//       console.log(`JWKS URL: ${jwksUrl.toString()}`);

//       console.log(`Pagination size: ${ITEMS_PER_PAGE} foods per page`);

//       console.log(
//         `Related items size: ${RELATED_ITEMS_PER_PAGE} foods per page`,
//       );
//     });
//   } catch (error) {
//     console.error("Unable to start ShareBite Server:", error);

//     await mongoClient.close();

//     process.exit(1);
//   }
// };

// void startServer();

// /* =========================================================
//    Graceful server shutdown
// ========================================================= */

// const shutdownServer = async (signal: string) => {
//   console.log(`${signal} received. Closing MongoDB connection...`);

//   try {
//     await mongoClient.close();

//     console.log("MongoDB connection closed successfully.");

//     process.exit(0);
//   } catch (error) {
//     console.error("Error closing MongoDB connection:", error);

//     process.exit(1);
//   }
// };

// process.on("SIGINT", () => {
//   void shutdownServer("SIGINT");
// });

// process.on("SIGTERM", () => {
//   void shutdownServer("SIGTERM");
// });



// export default app;




/* =========================================================
   Start local server
========================================================= */

if (process.env.NODE_ENV !== "production") {
  const startServer = async () => {
    try {
      await connectDatabase();

      app.listen(port, () => {
        console.log(
          `ShareBite Server is running on http://localhost:${port}`,
        );

        console.log(`JWKS URL: ${jwksUrl.toString()}`);

        console.log(
          `Pagination size: ${ITEMS_PER_PAGE} foods per page`,
        );

        console.log(
          `Related items size: ${RELATED_ITEMS_PER_PAGE} foods per page`,
        );
      });
    } catch (error) {
      console.error("Unable to start ShareBite Server:", error);

      await mongoClient.close();
    }
  };

  void startServer();
}

/*
 * Vercel uses this exported Express application.
 */
export default app;
