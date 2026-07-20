require("dotenv").config();
const { MongoClient } = require("mongodb");

const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB_NAME;

if (!mongoUri || !databaseName) {
  console.error(
    "❌ MONGODB_URI অথবা MONGODB_DB_NAME .env ফাইলে পাওয়া যায়নি!",
  );
  process.exit(1);
}

const REPLACE_WITH_USER_ID = "6a59b8a64bfdcd1323390a24";
const REPLACE_WITH_USER_EMAIL = "towfiqulislam017399@gmail.com";
const REPLACE_WITH_OWNER_NAME = "Towfiqul Islam (Towfiq)";
const REPLACE_WITH_CONTACT_NUMBER = "01712345678";

const now = () => new Date().toISOString();

const daysFromNow = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

const foods = [
  {
    foodName: "Chingri Bhuna",
    category: "Non-Veg",
    shortDescription: "Spicy homemade shrimp curry, freshly cooked",
    fullDescription:
      "Homemade chingri bhuna prepared with fresh prawns, mustard oil and traditional spices. Enough for 3-4 people. Please pick up before it goes cold.",
    location: "Mirpur, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1574484284002-952d92456975?auto=format&fit=crop&w=1200&q=80",
    servingSize: "3-4 people",
    isHalal: true,
    expiryDate: daysFromNow(1),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Crispy Chicken Fry",
    category: "Non-Veg",
    shortDescription: "Golden crispy fried chicken pieces",
    fullDescription:
      "Freshly fried crispy chicken made this evening, slightly more than we could finish. Well packed and still warm.",
    location: "Dhanmondi, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1505253758473-96b7015fcd40?auto=format&fit=crop&w=1200&q=80",
    servingSize: "2-3 people",
    isHalal: true,
    expiryDate: daysFromNow(1),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Nadan Beef Curry",
    category: "Non-Veg",
    shortDescription: "Traditional slow-cooked beef curry",
    fullDescription:
      "Rich, slow-cooked traditional beef curry made with onions, garlic and home-ground spices. Best served with hot rice or paratha.",
    location: "Mohammadpur, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1761314037211-63fff18c5187?auto=format&fit=crop&w=1200&q=80",
    servingSize: "4-5 people",
    isHalal: true,
    expiryDate: daysFromNow(2),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Amrit Fish Fry",
    category: "Non-Veg",
    shortDescription: "Crispy fried river fish with mustard marinade",
    fullDescription:
      "Freshly fried river fish (rui) marinated with turmeric and mustard oil. Cooked in small batches, extra pieces available.",
    location: "Uttara, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1692672166592-6e78b36ba37a?auto=format&fit=crop&w=1200&q=80",
    servingSize: "2-3 people",
    isHalal: true,
    expiryDate: daysFromNow(1),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Fish & Rice Meal",
    category: "Meal",
    shortDescription: "Complete meal with steamed rice and fish curry",
    fullDescription:
      "A full home-cooked meal set: steamed white rice with fish curry and a side of vegetables. Packed fresh, ready to reheat and serve.",
    location: "Banani, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1761314036779-84078bec535c?auto=format&fit=crop&w=1200&q=80",
    servingSize: "1-2 people",
    isHalal: true,
    expiryDate: daysFromNow(1),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Chicken Biryani",
    category: "Rice",
    shortDescription: "Aromatic chicken biryani with basmati rice",
    fullDescription:
      "Homemade chicken biryani cooked with basmati rice, saffron, ghee and traditional biryani spices. Made for a family event, extra portions available.",
    location: "Gulshan, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1559528896-c5310744cce8?auto=format&fit=crop&w=1200&q=80",
    servingSize: "5-6 people",
    isHalal: true,
    expiryDate: daysFromNow(1),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Beef Tehari",
    category: "Rice",
    shortDescription: "Spiced beef tehari with fragrant rice",
    fullDescription:
      "Traditional Bangladeshi beef tehari made with mustard oil and whole spices. Cooked for a family gathering, a good amount is left over.",
    location: "Badda, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=1200&q=80",
    servingSize: "4-5 people",
    isHalal: true,
    expiryDate: daysFromNow(1),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Khichuri with Egg",
    category: "Meal",
    shortDescription: "Comfort khichuri served with boiled egg",
    fullDescription:
      "Warm, comforting rice-and-lentil khichuri prepared during the rainy evening, served with boiled egg and a side of fried vegetables.",
    location: "Rampura, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1599043513900-ed6fe01d3833?auto=format&fit=crop&w=1200&q=80",
    servingSize: "3-4 people",
    isHalal: true,
    expiryDate: daysFromNow(1),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Mixed Vegetable Curry",
    category: "Veg",
    shortDescription: "Home-style mixed vegetable curry",
    fullDescription:
      "A wholesome mixed vegetable curry made with seasonal vegetables, potatoes and a light gravy. Suitable for vegetarians.",
    location: "Mirpur, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1630851840633-f96999247032?auto=format&fit=crop&w=1200&q=80",
    servingSize: "3-4 people",
    isHalal: true,
    expiryDate: daysFromNow(2),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Dal Bhat (Lentil & Rice)",
    category: "Meal",
    shortDescription: "Simple lentil soup with steamed rice",
    fullDescription:
      "A simple, home-cooked meal of masoor dal and steamed rice. Light on spice, good for anyone who wants an easy, comforting meal.",
    location: "Mohakhali, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1567982047351-76b6f93e38ee?auto=format&fit=crop&w=1200&q=80",
    servingSize: "2-3 people",
    isHalal: true,
    expiryDate: daysFromNow(1),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Mutton Rezala",
    category: "Non-Veg",
    shortDescription: "Mild, creamy mutton rezala",
    fullDescription:
      "Mutton rezala cooked in a mild, creamy yogurt-based gravy, prepared for a family occasion. A generous portion is still left.",
    location: "Baridhara, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1633945274405-b6c8069047b0?auto=format&fit=crop&w=1200&q=80",
    servingSize: "4-5 people",
    isHalal: true,
    expiryDate: daysFromNow(1),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Prawn Malaikari",
    category: "Non-Veg",
    shortDescription: "Coconut milk prawn curry",
    fullDescription:
      "Classic Bengali prawn malaikari cooked in coconut milk with fresh spices. Rich and flavorful, best paired with plain rice.",
    location: "Lalmatia, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1620894580123-466ad3a0ca06?auto=format&fit=crop&w=1200&q=80",
    servingSize: "3-4 people",
    isHalal: true,
    expiryDate: daysFromNow(1),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Chicken Tehari",
    category: "Rice",
    shortDescription: "Fragrant chicken tehari with potatoes",
    fullDescription:
      "Chicken tehari cooked with potatoes and whole garam masala. Prepared in a large batch for an office event, extra portions available.",
    location: "Malibagh, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1633945274309-2c16c9682a8c?auto=format&fit=crop&w=1200&q=80",
    servingSize: "5-6 people",
    isHalal: true,
    expiryDate: daysFromNow(1),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Beef Bhuna",
    category: "Non-Veg",
    shortDescription: "Thick, slow-cooked beef bhuna",
    fullDescription:
      "Dry-style beef bhuna, slow cooked until the spices coat every piece of meat. Pairs well with paratha or plain rice.",
    location: "Khilgaon, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1682622110397-37f6e928f890?auto=format&fit=crop&w=1200&q=80",
    servingSize: "3-4 people",
    isHalal: true,
    expiryDate: daysFromNow(2),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Vegetable Khichuri",
    category: "Veg",
    shortDescription: "Rainy day vegetable khichuri",
    fullDescription:
      "Soft rice-and-lentil khichuri cooked with seasonal vegetables. Made in a big pot for the family, extra containers are available.",
    location: "Shyamoli, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1697155406055-2db32d47ca07?auto=format&fit=crop&w=1200&q=80",
    servingSize: "3-4 people",
    isHalal: true,
    expiryDate: daysFromNow(1),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Egg Curry with Rice",
    category: "Meal",
    shortDescription: "Boiled egg curry served with rice",
    fullDescription:
      "Simple boiled egg curry in a light onion-tomato gravy, served with steamed rice. Quick, filling, home-cooked meal.",
    location: "Jatrabari, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1719239885399-f87d992e0f18?auto=format&fit=crop&w=1200&q=80",
    servingSize: "2 people",
    isHalal: true,
    expiryDate: daysFromNow(1),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Plain Rice & Fish Curry",
    category: "Meal",
    shortDescription: "Steamed rice with light fish curry",
    fullDescription:
      "Everyday home meal — plain steamed rice with a light, home-style fish curry. Made for the family, more than needed today.",
    location: "Tejgaon, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1654863404432-cac67587e25d?auto=format&fit=crop&w=1200&q=80",
    servingSize: "2-3 people",
    isHalal: true,
    expiryDate: daysFromNow(1),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Chicken Curry with Rice",
    category: "Meal",
    shortDescription: "Home-style chicken curry meal set",
    fullDescription:
      "Home-cooked chicken curry served with steamed rice, packed in a ready-to-reheat container. Cooked fresh this afternoon.",
    location: "Farmgate, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1710091691777-3115088962c4?auto=format&fit=crop&w=1200&q=80",
    servingSize: "2-3 people",
    isHalal: true,
    expiryDate: daysFromNow(1),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Beef Curry Special",
    category: "Non-Veg",
    shortDescription: "Festive-style special beef curry",
    fullDescription:
      "A special-occasion style beef curry made with extra ghee and whole spices, prepared for a small family gathering.",
    location: "Wari, Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1626508035297-0cd27c397d67?auto=format&fit=crop&w=1200&q=80",
    servingSize: "4-5 people",
    isHalal: true,
    expiryDate: daysFromNow(2),
    preparationDate: daysFromNow(0),
  },
  {
    foodName: "Community Iftar Platter",
    category: "Meal",
    shortDescription: "Mixed iftar items shared after community event",
    fullDescription:
      "Leftover iftar platter from a community event — a mix of rice, curry and snacks, still fresh and well packed. First come first served.",
    location: "Old Dhaka",
    imageUrl:
      "https://images.unsplash.com/photo-1692672166669-5df77d37e359?auto=format&fit=crop&w=1200&q=80",
    servingSize: "6+ people",
    isHalal: true,
    expiryDate: daysFromNow(1),
    preparationDate: daysFromNow(0),
  },
];

async function seed() {
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db(databaseName);
    const foodsCollection = db.collection("foods");

    const documents = foods.map((food) => ({
      ...food,
      ownerName: REPLACE_WITH_OWNER_NAME,
      contactNumber: REPLACE_WITH_CONTACT_NUMBER,
      userId: REPLACE_WITH_USER_ID,
      userEmail: REPLACE_WITH_USER_EMAIL,
      status: "available",
      views: 0,
      requests: 0,
      createdAt: now(),
      updatedAt: now(),
    }));

    const result = await foodsCollection.insertMany(documents);

    console.log(`✅ ${result.insertedCount}টা food document insert হয়েছে।`);
  } catch (error) {
    console.error("❌ Seed করার সময় সমস্যা হয়েছে:", error);
  } finally {
    await client.close();
  }
}

seed();
