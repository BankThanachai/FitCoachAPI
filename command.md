# คำสั่งที่ใช้ในโปรเจกต์ Fit Work API

เรียงตามลำดับที่ต้องทำจริง ตั้งแต่ setup ครั้งแรก ไปจนถึงงานที่ทำซ้ำระหว่าง dev

## 1. Setup ครั้งแรก (ทำครั้งเดียวตอน clone โปรเจกต์มาใหม่)

ต้องทำตามลำดับนี้ ข้ามลำดับไม่ได้ เพราะแต่ละขั้นต้องการผลลัพธ์จากขั้นก่อนหน้า

```bash
# 1. ติดตั้ง dependencies ของ Node
npm install

# 2. เปิด Docker Desktop ให้พร้อมทำงานก่อน (เปิดจากแอป หรือคำสั่งด้านล่าง)
open -a Docker

# 3. รัน Postgres container (ต้องรอ Docker daemon พร้อมก่อนถึงจะรันได้)
docker compose up -d db

# 4. เช็คว่า container ทำงานและ "healthy" แล้วค่อยไปขั้นต่อไป
docker compose ps

# 5. สร้างตารางในฐานข้อมูลตาม schema.prisma (ต้องรอ db healthy ก่อน)
npx prisma migrate dev

# 6. รัน API
npm run start:dev
```

หลังจากนี้ API จะรันอยู่ที่ `http://localhost:3000/api/v1`

⚠️ ต้องมี `JWT_ACCESS_SECRET` และ `JWT_REFRESH_EXPIRES_IN` ฯลฯ ใน `.env` ด้วย
(ดูตัวอย่างค่าที่ต้องตั้งใน `.env.example`) ไม่งั้น auth endpoint จะ error ตอนสตาร์ท
สร้าง secret ใหม่ด้วยคำสั่ง:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 2. คำสั่งที่ใช้บ่อยระหว่าง dev (วันต่อวัน)

| คำสั่ง | ทำอะไร | ใช้ตอนไหน |
|---|---|---|
| `docker compose up -d db` | เปิด Postgres container | ทุกครั้งที่เริ่มงานใหม่ (หลังปิดเครื่อง/รีสตาร์ท) |
| `npm run start:dev` | รัน NestJS แบบ watch mode (แก้โค้ดแล้ว auto reload) | ระหว่างเขียนโค้ด |
| `docker compose ps` | เช็คสถานะ container ว่ารันอยู่/healthy ไหม | เวลาต่อ DB ไม่ได้ ใช้เช็คก่อน |
| `docker compose logs -f db` | ดู log ของ Postgres แบบ real-time | เวลา DB มีปัญหา ต้องดู log |
| `npx prisma studio` | เปิดหน้าเว็บ GUI ดู/แก้ข้อมูลในตารางแบบไม่ต้องเขียน SQL | เช็คข้อมูลระหว่าง dev |

---

## 3. เมื่อแก้ไข schema.prisma (เพิ่ม/แก้ table หรือ column)

ต้องทำตามลำดับนี้เท่านั้น ห้ามข้าม:

```bash
# 1. แก้ไฟล์ prisma/schema.prisma ให้เรียบร้อยก่อน

# 2. สร้าง migration ใหม่ + apply เข้า database ทันที
npx prisma migrate dev --name <ตั้งชื่อสั้นๆ อธิบายว่าแก้อะไร เช่น add_workout_table>

# 3. (Prisma Client จะ regenerate อัตโนมัติ แต่ถ้าจำเป็นรันเองได้ด้วย)
npx prisma generate
```

คำสั่งนี้จะสร้างไฟล์ในโฟลเดอร์ `prisma/migrations/` เก็บประวัติไว้ — ต้อง commit ไฟล์นี้เข้า git ด้วยเสมอ (ห้ามลบ/แก้ไฟล์ migration เก่าที่ commit ไปแล้ว)

### ถ้า `prisma migrate dev` ขึ้น error "environment is non-interactive"

เกิดตอนที่ Prisma มี warning ต้องให้ confirm (เช่น เพิ่ม unique constraint บน column ที่มีข้อมูลซ้ำอยู่แล้ว)
แต่รันในเครื่องมือที่ไม่รองรับการพิมพ์ตอบโต้ (เช่นรันผ่าน AI agent/CI) ให้แก้ด้วยวิธีนี้แทน:

```bash
# 1. เช็คก่อนว่าตารางที่จะแก้มีข้อมูลอยู่ไหม (สำคัญ - ถ้ามีข้อมูลอาจต้อง backfill ก่อน)
docker compose exec -T db psql -U fitwork -d fitwork -c 'SELECT count(*) FROM "User";'

# 2. สร้าง SQL diff เอง (ไม่ apply ทันที)
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script

# 3. สร้างโฟลเดอร์ migration ตามรูปแบบ Prisma (ชื่อ = timestamp_ชื่อ)
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_<ชื่อ migration>

# 4. เอา SQL จากขั้นตอน 2 ไปวางในไฟล์ migration.sql ของโฟลเดอร์ที่สร้าง

# 5. Apply migration แบบ non-interactive (ใช้ได้ทั้ง dev และ production)
npx prisma migrate deploy
```

⚠️ วิธีนี้ต้องเช็คตาราง (ขั้นตอน 1) ก่อนเสมอ ถ้ามีข้อมูลอยู่แล้วและ column ใหม่เป็น
required โดยไม่มี default value จะ apply ไม่ผ่าน ต้องใส่ default value ชั่วคราวหรือ
backfill ข้อมูลก่อน

---

## 4. หยุดงาน / เคลียร์

| คำสั่ง | ทำอะไร | ระวัง |
|---|---|---|
| `docker compose down` | หยุด container ทั้งหมด | ข้อมูลใน database ยังอยู่ (เก็บใน volume) ปลอดภัย |
| `docker compose down -v` | หยุด container **และลบข้อมูลใน database ทิ้งทั้งหมด** | ⚠️ ใช้เฉพาะตอนอยากล้าง DB ใหม่หมดเท่านั้น ข้อมูลหายถาวร |

---

## 5. รันทั้ง app + db ผ่าน Docker พร้อมกัน (ทางเลือกแทนข้อ 1)

ถ้าไม่อยากรัน `npm run start:dev` แยก จะให้ Docker รันทั้ง app และ db พร้อมกันก็ได้:

```bash
docker compose up -d
```

ข้อแตกต่าง: วิธีนี้ app จะรันอยู่ "ใน container" ไม่ใช่รันตรงเครื่อง ถ้าจะแก้โค้ดแล้วอยาก auto-reload ทันที การรัน `npm run start:dev` ตรงเครื่อง (ข้อ 1) จะสะดวกกว่าเวลา dev

---

## 6. API Versioning (`/api/v1`, `/api/v2`)

โปรเจกต์เปิดใช้ URI versioning ไว้แล้วใน `src/main.ts` ทุก endpoint จะขึ้นต้นด้วย
`/api/v<เลขเวอร์ชัน>` เสมอ เช่น `http://localhost:3000/api/v1/users`

### เพิ่ม version ใหม่ทั้ง controller (เช่น v2 ของ users ทั้งหมด)

สร้าง controller ใหม่แล้วระบุ version ต่างกัน:

```typescript
@Controller({ path: 'users', version: '2' })
export class UsersControllerV2 { ... }
```

แล้วเพิ่มเข้า `providers`/`controllers` ใน `users.module.ts`

### เพิ่ม version เฉพาะบาง endpoint (endpoint อื่นในไฟล์เดิมคง v1 ไว้)

ใช้ `@Version()` ทับ decorator เดิมของ method นั้น:

```typescript
@Get()
@Version('1')
findAllV1() { ... }

@Get()
@Version('2')
findAllV2() { ... }
```

**ข้อควรระวัง**: ถ้าจะแก้ path prefix (`api`) หรือ default version ต้องแก้ที่
`app.setGlobalPrefix('api')` และ `app.enableVersioning(...)` ใน `src/main.ts`
เท่านั้น ไม่ต้องแก้ทีละ controller

---

## 7. Authentication (login ด้วย phone + password, JWT + refresh token)

### Flow

```
POST /api/v1/users          → สมัครสมาชิก (public, ไม่ต้อง login)
POST /api/v1/auth/login     → login ด้วย phone+password ได้ accessToken + refreshToken
POST /api/v1/auth/refresh   → ใช้ refreshToken แลก accessToken/refreshToken ชุดใหม่
POST /api/v1/auth/logout    → revoke refreshToken (ใช้ต่อไม่ได้อีก)
```

Route อื่นทั้งหมดใน `users` (ยกเว้น register) ต้องแนบ header:

```
Authorization: Bearer <accessToken>
```

### อายุ token

| Token | อายุ | เก็บที่ไหน |
|---|---|---|
| Access token (JWT) | 15 นาที (`JWT_ACCESS_EXPIRES_IN`) | ไม่เก็บใน DB — verify ด้วย secret อย่างเดียว |
| Refresh token | 30 วัน (`JWT_REFRESH_EXPIRES_IN`) | เก็บ **hash** (SHA-256) ไว้ในตาราง `RefreshToken` เพื่อให้ revoke ได้ |

### กติกาเรื่อง refresh token

- **Rotate ทุกครั้ง**: ใช้ `refresh` แล้วจะได้ token คู่ใหม่เสมอ ตัวเก่าจะถูก revoke ทันที
  ใช้ตัวเก่าซ้ำไม่ได้อีก (กันกรณี token หลุดแล้วถูกขโมยไปใช้)
- **Logout = revoke**: เรียก `/auth/logout` แล้ว refresh token นั้นใช้ต่อไม่ได้ทันที
- Access token ที่ออกไปแล้วจะยังใช้ได้จนกว่าจะหมดอายุเอง (revoke access token กลางคันทำไม่ได้
  เพราะเป็น stateless JWT — นี่คือเหตุผลที่ตั้งอายุสั้นแค่ 15 นาที)

### ทดสอบด้วย curl

```bash
# login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"+66812345678","password":"yourpassword"}'

# เรียก protected route
curl http://localhost:3000/api/v1/users \
  -H "Authorization: Bearer <accessToken>"

# refresh
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refreshToken>"}'

# logout
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refreshToken>"}'
```

---

## 8. Reviews (Client รีวิว Trainer)

### Flow

```
POST /api/v1/reviews          → สร้างรีวิว (ต้อง login เป็น Client)
GET  /api/v1/reviews/user/:userId → ดูรีวิวทั้งหมดของ user คนนั้น + ค่าเฉลี่ย
```

กติกา:
- **เฉพาะ Client รีวิวได้** และ **รีวิวได้เฉพาะ Trainer** เท่านั้น (validate ที่ service)
- **รีวิวซ้ำคนเดิมได้ไม่จำกัดจำนวนครั้ง** ไม่มี unique constraint ระหว่าง reviewer-target
- `reviewerId` ดึงจาก JWT (`request.user.sub`) เสมอ **ไม่รับจาก body** — กัน client
  ปลอมตัวเป็นคนอื่นตอนรีวิว
- `score` ต้องเป็นจำนวนเต็ม 0-5 เท่านั้น (validate ผ่าน DTO)
- `GET /reviews/user/:userId` ใช้ได้กับ user ทุก type ไม่จำกัดแค่ Trainer เผื่ออนาคต
  แต่ปัจจุบันจะมีรีวิวจริงเฉพาะ Trainer เท่านั้น (เพราะสร้างได้แค่ Client→Trainer)

### ทดสอบด้วย curl

```bash
# สร้างรีวิว (ต้องมี accessToken ของ client)
curl -X POST http://localhost:3000/api/v1/reviews \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -d '{"targetUserId":"<trainerId>","score":5,"comment":"เก่งมาก"}'

# ดูรีวิวของ trainer คนนั้น + ค่าเฉลี่ย
curl http://localhost:3000/api/v1/reviews/user/<trainerId>
```

Response ของ `GET /reviews/user/:userId`:

```json
{
  "reviews": [ { "id": "...", "score": 5, "comment": "...", "reviewerId": "...", "createdAt": "..." } ],
  "averageScore": 4.5,
  "totalReviews": 2
}
```

`averageScore` คำนวณผ่าน Prisma `aggregate` ที่ระดับ database (ไม่ได้ดึงข้อมูลทั้งหมด
มาคำนวณใน JS) และปัดเป็นทศนิยม 2 ตำแหน่ง ถ้ายังไม่มีรีวิวเลยจะได้ `averageScore: 0`

---

## สรุปลำดับสั้นๆ (ถ้าจำได้แค่บรรทัดเดียว)

```
เปิด Docker → docker compose up -d db → npx prisma migrate dev (ถ้ามีการแก้ schema) → npm run start:dev
```
