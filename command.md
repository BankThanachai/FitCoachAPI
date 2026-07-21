# คำสั่งที่ใช้ในโปรเจกต์ FitCoachAPI

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

หลังจากนี้ API จะรันอยู่ที่ `http://localhost:3000`

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

## สรุปลำดับสั้นๆ (ถ้าจำได้แค่บรรทัดเดียว)

```
เปิด Docker → docker compose up -d db → npx prisma migrate dev (ถ้ามีการแก้ schema) → npm run start:dev
```


docker compose ps