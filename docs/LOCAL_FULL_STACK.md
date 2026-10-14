# Run Backend + Frontend locally (secrets stay on your machine)

## 1. MongoDB

```bash
cd Backend
docker compose up -d
```

Use in **Backend `.env`** (never commit):

```env
MONGODB_URI=mongodb://localhost:27017/zentrosure
```

## 2. Backend API

```bash
cd Backend
cp .env.example .env
# Edit .env — local Mongo URI + JWT secrets + optional Cloudinary
npm install
npm run db:seed
npm run dev
```

API: http://localhost:3000/health

## 3. Frontend → local API (not in git)

```bash
cd Frontend
cp .env.local.example .env.local
npm install
npm run dev
```

**`.env.local`** (gitignored):

```env
VITE_USE_LOCAL_API=false
VITE_API_BASE_URL=/api/v1
```

Vite proxies `/api/v1` → `http://localhost:3000` (no CORS).

Without `.env.local`, the UI stays in **browser-only demo mode** (`VITE_USE_LOCAL_API` default).

## Demo login

| Field | Value |
|-------|-------|
| Tenant | `DEMO-MOTORS` |
| Email | `rajesh@demomotors.com` |
| Password | `demo1234` |
