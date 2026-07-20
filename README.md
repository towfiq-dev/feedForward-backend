<div align="center">

# 🍱 Feedforward — Backend

### REST API Server for the Feedforward Community Surplus Food-Sharing Platform

**Feedforward Backend** is the REST API that powers the Feedforward web application. It is built with **Express.js 5**, **TypeScript**, and **MongoDB**, and handles food listings, food requests, request approvals/rejections, community statistics, and JWT-based authorization for the Feedforward frontend.

</div>

---

## 📋 Table of Contents

- [Project Overview](#-project-overview)
- [Technology Stack](#-technology-stack)
- [Authentication and Authorization](#-authentication-and-authorization)
- [Database Collections and Indexes](#-database-collections-and-indexes)
- [Environment Variables](#-environment-variables)
- [Installation and Setup](#-installation-and-setup)
- [API Overview](#-api-overview)
- [Business Rules](#-business-rules)
- [Error Handling](#-error-handling)
- [Deployment](#-deployment)
- [Project Structure](#-project-structure)
- [Developer](#-developer)

---

## 📌 Project Overview

The Feedforward backend exposes a REST API for:

- Publishing and managing surplus food listings
- Searching, filtering, sorting, and paginating available food
- Submitting food requests and tracking their status
- Approving or rejecting incoming food requests
- Automatically rejecting other pending requests once one is approved
- Serving public community impact statistics

All protected routes are secured using **JWT verification against a Better Auth JWKS endpoint**, so authentication is issued by the Feedforward frontend (Better Auth) and verified independently by this Express server.

---

## 🛠️ Technology Stack

| Technology | Purpose |
|------------|---------|
| Node.js | Backend JavaScript runtime |
| Express.js 5 | REST API framework |
| TypeScript | Typed backend development |
| MongoDB (native driver) | Data storage for foods, food requests, and users |
| MongoDB Atlas | Cloud database hosting |
| jose-cjs | JWT verification against a remote JWKS endpoint |
| cors | Cross-origin request handling |
| dotenv | Environment variable management |
| Vercel | Serverless backend deployment |

---

## 🔑 Authentication and Authorization

Feedforward does not issue its own JWTs. Instead, it trusts tokens issued by **Better Auth** on the frontend and verifies them independently.

### How it works

```text
Frontend (Better Auth) issues a signed JWT
              ↓
Frontend sends the token in the Authorization header
              ↓
Backend fetches the JWKS from:
  {BETTER_AUTH_URL}/api/auth/jwks
              ↓
jose-cjs verifies the token signature and claims
              ↓
Verified userId / userName / userEmail are attached to the request
              ↓
Route handler executes with req.userId available
```

### Protected Request Example

```http
Authorization: Bearer <jwt_token>
```

### Authorization Rules

- Only the **food owner** can update, delete, or manage requests for their own food.
- Only the **requester** can view or delete their own submitted requests.
- Food owners cannot submit a request for their own food.
- Every protected route uses the shared `verifyToken` middleware; invalid, missing, or expired tokens return `401` / `403`.

---

## 🗄️ Database Collections and Indexes

### Collections

| Collection | Purpose |
|------------|---------|
| `foods` | Stores all shared food listings |
| `food-requests` | Stores all requests submitted for food listings |
| `user` | Better Auth user records (read-only from this server) |

### Key Indexes

**`foods`**
- `foodName`, `category`, `location`, `userId`, `status`, `expiryDate`, `createdAt`
- Compound indexes: `status + createdAt`, `status + category`, `status + location`, `status + expiryDate`, `userId + createdAt`

**`food-requests`**
- Unique compound index on `foodId + requesterUserId` (prevents duplicate requests for the same food by the same user)
- `requesterUserId + requestDate`, `foodOwnerId + status + requestDate`, `foodId + status`, `status + requestDate`, `foodOwnerId + requestDate`, `requesterUserId + status + requestDate`

Indexes are created automatically the first time the server connects to MongoDB.

---

## 🔒 Environment Variables

Create a `.env` file in the project root:

```env
PORT=5000
NODE_ENV=development

MONGODB_URI=your_mongodb_connection_string
MONGODB_DB_NAME=your_database_name

CLIENT_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
```

For production:

```env
NODE_ENV=production
CLIENT_URL=https://your-frontend-domain.vercel.app
BETTER_AUTH_URL=https://your-frontend-domain.vercel.app
```

| Variable | Required | Description |
|----------|----------|--------------|
| `PORT` | No (defaults to `5000`) | Port the local server listens on |
| `MONGODB_URI` | Yes | MongoDB Atlas / MongoDB connection string |
| `MONGODB_DB_NAME` | Yes | Name of the database to use |
| `CLIENT_URL` | Yes | Allowed CORS origin (the frontend URL) |
| `BETTER_AUTH_URL` | Yes | Base URL used to build the JWKS endpoint (`{BETTER_AUTH_URL}/api/auth/jwks`) for JWT verification |
| `NODE_ENV` | No | `development` or `production`; controls local server startup and error detail |

> The server exits immediately at startup if `MONGODB_URI` or `MONGODB_DB_NAME` is missing.

> Never commit `.env`, MongoDB connection strings, or production credentials to GitHub.

---

## 💻 Installation and Setup

### Prerequisites

- Node.js 18 or newer
- npm
- MongoDB Atlas account or local MongoDB
- A running Feedforward frontend (for Better Auth / JWKS)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/kouser-ahamed/feedforward-backend.git
cd feedforward-backend

# 2. Install dependencies
npm install

# 3. Configure environment variables
# Create a .env file as shown above

# 4. Run the development server
npm run dev
```

The backend will run at:

```text
http://localhost:5000
```

### Production Build

```bash
npm run build
npm run start
```

> In production (`NODE_ENV=production`), the server does not call `app.listen` locally; the Express app is exported as the default export for Vercel's serverless runtime.

---

## 🔌 API Overview

### Health Check

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/` | Public | Returns a simple "server is running" message |

### Foods

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/foods` | Public | List available foods with `search`, `category`, `location`, `expiryDate`, `sort`, and `page` query params; returns pagination info and available filter options |
| GET | `/api/foods/latest` | Public | Returns the 4 most recently shared available foods |
| GET | `/api/foods/expiring-soon` | Public | Returns the 4 available foods with the nearest (non-expired) expiry date |
| GET | `/api/foods/:id/related` | Public | Returns available foods in the same category as `:id`, paginated |
| GET | `/api/foods/:id` | Public | Returns a single available food and increments its view count |
| POST | `/api/food-share` | 🔒 Required | Creates a new food listing owned by the authenticated user |
| PATCH | `/api/foods/:id` | 🔒 Required (owner only) | Partially updates a food listing; supports updating `status` to `available`, `booked`, or `unavailable` |
| DELETE | `/api/foods/:id` | 🔒 Required (owner only) | Deletes a food listing |
| GET | `/api/my-shared-foods/:userId` | 🔒 Required (self only) | Returns all foods shared by the authenticated user |

### Food Requests

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/food-requests/check/:foodId` | 🔒 Required | Checks whether the current user is the owner or has already requested this food |
| POST | `/api/food-requests/:foodId` | 🔒 Required | Submits a food request (phone number, address, description, needed date); blocked for the food's own owner, expired food, or duplicate requests |
| GET | `/api/my-requests` | 🔒 Required | Returns all requests submitted by the authenticated user, with status counts |
| DELETE | `/api/my-requests/:requestId` | 🔒 Required (requester only) | Deletes the authenticated user's own request |

### Incoming Food Requests (Owner Side)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/incoming-food-requests` | 🔒 Required | Returns all requests received for the authenticated user's foods, with status counts |
| PATCH | `/api/incoming-food-requests/:requestId/decision` | 🔒 Required (owner only) | Approves (with pickup location, contact number, owner message) or rejects (with a reason) a pending request |
| DELETE | `/api/incoming-food-requests/:requestId` | 🔒 Required (owner only) | Deletes a single incoming request |
| DELETE | `/api/incoming-food-requests/food/:foodId` | 🔒 Required (owner only) | Deletes every request received for one food item |

### Community Information

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/community-impact` | Public | Returns total food posts, total requests, approved/rejected/pending counts, and total users |

---

## 📐 Business Rules

- A user **cannot** request their own shared food.
- A user **cannot** send more than one request for the same food (enforced by a unique MongoDB index and a friendly pre-check).
- A food request's **needed date** must fall between today and the food's expiry date (inclusive).
- Approving a request changes the food's status from `available` to `booked`, and **automatically rejects** every other pending request for that same food.
- Approval requires pickup location, contact number, and an owner message; rejection requires a rejection reason.
- Deleting a request does not change the food's status — an approved food stays `booked` even if the related request is later deleted.
- Every write and management route validates that the authenticated user actually owns the food or the request before allowing changes.

---

## ⚠️ Error Handling

- `400` — Invalid input (missing fields, invalid ObjectId, invalid dates, field length limits)
- `401` — Missing or unauthenticated request
- `403` — Authenticated but not authorized to access/modify the resource
- `404` — Resource not found
- `409` — Conflict (duplicate request, request already decided, food already claimed)
- `500` — Unexpected server error (stack details only exposed when `NODE_ENV=development`)
- `503` — Database not yet connected
- Unmatched routes return a `404` JSON response with the attempted method and path.

---

## ☁️ Deployment

- The Express app is exported as the default export (`export default app`) so it can run as a Vercel serverless function.
- Locally (`NODE_ENV !== "production"`), the app connects to MongoDB and starts listening on `PORT` via `app.listen`.
- In production, MongoDB connects lazily on the first incoming `/api` request via the `connectDatabase()` middleware.

---

## 📁 Project Structure

```text
feedforward-backend/
├── index.ts
├── .env
├── package.json
├── tsconfig.json
└── README.md
```

---

## 👨‍💻 Developer

**Towfiqul Islam**

### Contact

```text
Email : towfiqulislam@gmail.com
Phone : 01758457125
```

### Social Profiles

- Facebook: https://www.facebook.com/towfiqul618539
- GitHub: https://github.com/towfiq-dev
- LinkedIn: https://www.linkedin.com/in/towfiqulislam1

---

<div align="center">

### Share Food. Reduce Waste. Strengthen Community.

© 2026 Feedforward. All rights reserved.

</div>