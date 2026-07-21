# FitCoachAPI

Backend API สำหรับต่อกับ FitCoach mobile app

## Stack

- **Framework**: NestJS (Node.js + TypeScript)
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Containerization**: Docker + Docker Compose

## สถาปัตยกรรม

### Dev environment (เครื่องตัวเอง)

```
[Docker Compose]
  ├─ app container  (NestJS, port 3000)
  └─ db container   (PostgreSQL 16, port 5432)
```

App และ Database รันเป็น container คนละตัวแต่อยู่ใน docker-compose network เดียวกัน
ต่อกันผ่านชื่อ service (`db`) ไม่ใช่ `localhost`

### Production

```
[Mobile App]
     │
     ▼
[Reverse Proxy / Load Balancer]  (Caddy, Nginx, หรือ Cloud LB)
     │
     ▼
[NestJS Container]  ← deploy ผ่าน Cloud Run / ECS Fargate / VPS
     │
     ▼
[Managed PostgreSQL]  (RDS / Supabase / Neon — แยก infra จาก app)
```

**หลักการสำคัญ**: Database ไม่ควรรันเป็น container เดียวกับ app บน production
เพราะ backup/scaling/data persistence จัดการยากกว่าถ้าอยู่ container
แนะนำใช้ managed database service แทน ส่วน app container เชื่อมต่อผ่าน
`DATABASE_URL` (connection string) เหมือนเดิมทุกอย่าง — เปลี่ยนแค่ env var
ตอน deploy โดยไม่ต้องแก้โค้ด

## เริ่มใช้งาน (Dev)

### 1. ติดตั้ง dependencies

```bash
npm install
```

### 2. ตั้งค่า environment variables

คัดลอก `.env.example` เป็น `.env` (มีอยู่แล้วสำหรับ dev, ค่า default ใช้ได้เลย)

```
DATABASE_URL=postgresql://fitcoach:fitcoach_dev_password@localhost:5432/fitcoach?schema=public
```

### 3. รัน PostgreSQL ผ่าน Docker

```bash
docker compose up -d db
```

เช็คว่า container ทำงานและ healthy:

```bash
docker compose ps
```

### 4. รัน Prisma migration (สร้างตารางในฐานข้อมูล)

```bash
npx prisma migrate dev
```

### 5. รัน NestJS app

```bash
npm run start:dev
```

App จะรันที่ `http://localhost:3000`

### รันทั้ง app + db ผ่าน Docker (ทางเลือก)

```bash
docker compose up -d
```

### คำสั่งที่ใช้บ่อย

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `docker compose up -d` | รัน container ทั้งหมดแบบ background |
| `docker compose down` | หยุด container ทั้งหมด (ข้อมูลใน volume ยังอยู่) |
| `docker compose down -v` | หยุด container และลบข้อมูลใน database ทิ้งด้วย |
| `docker compose logs -f app` | ดู log ของ app container แบบ real-time |
| `docker compose ps` | เช็คสถานะ container |
| `npx prisma studio` | เปิด GUI ดู/แก้ข้อมูลในฐานข้อมูล |
| `npx prisma migrate dev --name <ชื่อ>` | สร้าง migration ใหม่หลังแก้ schema |

## โครงสร้างโปรเจกต์

```
src/            NestJS source code
prisma/
  schema.prisma Prisma schema (model ต่างๆ)
  migrations/   ประวัติ migration ของฐานข้อมูล
Dockerfile      multi-stage build สำหรับ production image
docker-compose.yml   dev environment (app + db)
```
