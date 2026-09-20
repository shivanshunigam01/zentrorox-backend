# ZentroSure Backend

Automotive Workshop ERP — Node.js + Express + MongoDB + Cloudinary API.

## Stack

- **Node.js** + **TypeScript**
- **Express 5** — REST API
- **MongoDB** + **Mongoose** — Database & ODM
- **Cloudinary** — Image upload & CDN
- **JWT** — Authentication
- **Multer** — Multipart file handling
- **Zod** — Validation
- **bcryptjs** — Password hashing

## Quick Start

### 1. Start MongoDB

```bash
docker compose up -d
```

Or use [MongoDB Atlas](https://www.mongodb.com/atlas) and set `MONGODB_URI` in `.env`.

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
- Set `MONGODB_URI` (default: `mongodb://localhost:27017/zentrosure`)
- Add Cloudinary credentials from [cloudinary.com](https://cloudinary.com) for image uploads

### 3. Install & Seed Database

```bash
npm install
npm run db:seed
```

### 4. Start API Server

```bash
npm run dev
```

API runs at **http://localhost:3000**

## Demo Credentials

| Field | Value |
|-------|-------|
| Tenant Code | `DEMO-MOTORS` |
| Email | `rajesh@demomotors.com` |
| Password | `demo1234` |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/auth/refresh` | Refresh token |
| POST | `/api/v1/auth/logout` | Logout (auth required) |
| GET | `/api/v1/auth/me` | Current user |
| GET | `/api/v1/dashboard` | Dashboard KPIs |
| GET/POST | `/api/v1/customers` | Customer CRUD |
| GET/POST | `/api/v1/vehicles` | Vehicle CRUD |
| GET/POST | `/api/v1/bookings` | Booking management |
| GET | `/api/v1/service-visits` | Service visits list |
| GET | `/api/v1/service-visits/wip` | WIP control board |
| GET | `/api/v1/service-visits/:id` | Service visit detail |
| POST | `/api/v1/service-visits/from-booking/:id` | Create visit from booking |
| PATCH | `/api/v1/service-visits/:id/advance-stage` | Advance workflow stage |
| POST | `/api/v1/uploads/image` | Upload single image (Cloudinary) |
| POST | `/api/v1/uploads/images` | Upload multiple images |
| POST | `/api/v1/uploads/service-visits/:id/inspection` | Upload inspection photos |
| GET | `/api/v1/uploads` | List uploaded media |
| DELETE | `/api/v1/uploads/:publicId` | Delete image |

### Authentication

```
Authorization: Bearer <access_token>
X-Branch-Id: <branch_id>   (optional)
```

### Login Example

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"tenantCode":"DEMO-MOTORS","identifier":"rajesh@demomotors.com","password":"demo1234"}'
```

### Image Upload Example

```bash
curl -X POST http://localhost:3000/api/v1/uploads/image \
  -H "Authorization: Bearer <token>" \
  -F "file=@/path/to/photo.jpg" \
  -F "entityType=vehicle" \
  -F "entityId=<vehicle_id>"
```

## Architecture

```
src/
├── config/          # Environment config
├── middleware/      # Auth, upload, tenant isolation, errors
├── models/          # Mongoose schemas (MongoDB)
├── modules/         # Feature modules (routes + services)
│   ├── auth/
│   ├── dashboard/
│   ├── customers/
│   ├── vehicles/
│   ├── bookings/
│   ├── service-visits/
│   └── uploads/     # Cloudinary image uploads
├── lib/             # MongoDB & Cloudinary clients
├── scripts/         # Database seed
├── utils/           # Numbering, audit, errors
└── types/           # TypeScript declarations
```

## Multi-Tenancy

- Every transactional record includes `tenantId`
- JWT encodes tenant context
- Middleware enforces tenant isolation on all API routes
- Branch scoping via `X-Branch-Id` header

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm run start` | Run production build |
| `npm run db:seed` | Seed demo data into MongoDB |

## Frontend Integration

Set in Frontend `.env`:

```
VITE_API_BASE_URL=http://localhost:3000/api/v1
```
