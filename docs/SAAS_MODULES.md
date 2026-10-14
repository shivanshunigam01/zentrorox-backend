# ZentroSure SaaS API modules

Multi-tenant automotive workshop ERP. All business routes live under `/api/v1` and require JWT except `POST /auth/login` and `POST /auth/refresh`.

| Module | Base path | Purpose |
|--------|-----------|---------|
| Auth | `/auth` | Login, refresh, logout, current user |
| Tenant | `/tenant` | Organization profile |
| Dashboard | `/dashboard` | KPIs, WIP snapshot, charts |
| Customers | `/customers` | CRM customers |
| Vehicles | `/vehicles` | Customer vehicles |
| Bookings | `/bookings` | Service bookings |
| Service visits | `/service-visits` | End-to-end workshop workflow |
| Job cards | `/job-cards` | Approved work orders |
| Parts | `/parts` | Catalog + stock |
| Bays | `/bays` | Workshop floor |
| Branches | `/branches` | Branch list |
| Users | `/users` | Staff / technicians |
| Masters | `/masters` | Configurable dropdowns |
| Search | `/search` | Global search |
| Uploads | `/uploads` | Cloudinary media |

## Tenancy

- Login with `tenantCode` + user credentials.
- JWT carries `tenantId`; queries are scoped automatically.
- Optional header: `X-Branch-Id` for branch-specific data.

## Local full stack

See [LOCAL_FULL_STACK.md](./LOCAL_FULL_STACK.md).
