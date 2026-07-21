# Authentication Architecture

อธิบายหลักการเบื้องหลังระบบ auth ของโปรเจกต์นี้ — ทำไมถึงออกแบบแบบนี้ ไม่ใช่แค่ทำอะไร
(ดูวิธีเรียกใช้ endpoint จริงได้ที่ [command.md](command.md) หมวด 7)

## ทำไม access token กับ refresh token ใช้คนละ format กัน

| | Access token | Refresh token |
|---|---|---|
| Format | JWT | Random opaque string (`crypto.randomBytes`) |
| อายุ | 15 นาที | 30 วัน |
| เก็บใน DB ไหม | ไม่เก็บ | เก็บ (เป็น SHA-256 hash) ในตาราง `RefreshToken` |
| Revoke ได้ทันทีไหม | ไม่ได้ (ต้องรอหมดอายุเอง) | ได้ (revoke ผ่าน DB) |

เหตุผลที่ไม่ได้ใช้ JWT ทั้งคู่: **จุดขายของ JWT คือ verify ได้โดยไม่ต้องถาม DB** (stateless)
เราใช้ประโยชน์จากจุดนี้เต็มที่กับ **access token** เพราะมันถูกแนบไปกับแทบทุก request —
ยิ่ง verify เร็วโดยไม่ query DB ยิ่งดีต่อ performance

แต่ **refresh token ต้อง revoke ได้จริง** (logout, rotate ตอนใช้ซ้ำ) — การ revoke ได้จริง
บังคับให้ต้อง query DB ทุกครั้งอยู่ดี (เพราะ JWT ล้วนๆ verify แค่ signature+exp
ไม่มีทางรู้ว่าถูก "ยกเลิก" ไปแล้วหรือยัง) พอต้องเช็ค DB อยู่แล้ว การห่อด้วย JWT
จึงไม่ได้ประโยชน์เพิ่ม มีแต่ข้อเสีย:

- **ขนาดใหญ่กว่า** โดยไม่จำเป็น (payload ที่ไม่เคยถูกอ่านไปใช้งานจริง)
- **รั่วข้อมูลถ้าหลุด** — payload ของ JWT อ่านได้เสมอ (base64 decode เฉยๆ ไม่ต้องมี secret)
  ถ้า refresh token เป็น JWT แล้วหลุดไปอยู่ใน log/error tracking คนร้ายจะเห็น
  `phone`, `type`, `user id` ทันที ต่างจาก random string ที่เป็นแค่ hex ไร้ความหมาย
- **CPU cost สูงกว่า** — ต้อง verify signature เพิ่ม ทั้งที่สุดท้ายก็ต้องพึ่ง DB
  เป็นตัวตัดสินใจจริงอยู่ดี

สรุป: revoke ได้เป็นสิ่งที่ต้องมี (เพื่อรองรับ logout/security) และมันมาพร้อม
"ต้อง query DB" อยู่แล้วไม่ว่าจะเลือก format ไหน ดังนั้นเลือก format ที่เบาที่สุด
(random string) แทนที่จะแบก JWT overhead ไปฟรีๆ

## ความเข้าใจผิดที่พบบ่อย: "JWT refresh token" หมายถึงต้องเป็น JWT format เสมอไปไหม

ไม่จำเป็น คำว่า "JWT refresh token" ในหลาย source หมายถึง **หน้าที่** (long-lived
credential ที่ใช้แลก access token ใหม่โดยไม่ต้อง login ซ้ำ) ไม่ได้บังคับว่าตัว token
เองต้องเข้ารหัสแบบ JWT

ข้อเท็จจริงทาง cryptography ที่ยืนยันได้แน่นอน: **JWT ล้วนๆ ที่ verify แค่
signature + exp (ไม่มี state เสริม) revoke ไม่ได้ 100%** เพราะการ verify เป็น
pure function ไม่มี input จาก DB เลย ต่อให้ admin กด "revoke" ที่ไหนสักที่
JWT ตัวเดิมที่ user ถืออยู่ก็ยัง verify ผ่านได้จนกว่าจะหมดอายุเอง

ระบบจริงที่โฆษณาว่า "revoke JWT ได้" ทำได้เพราะเสริม state เข้าไปเสมอ (ไม่มีข้อยกเว้น)
ด้วยหนึ่งในสองวิธีนี้:

1. **Denylist/Blocklist** — เก็บ JWT ที่ถูก revoke ไว้ใน DB/Redis, ทุกครั้งที่ verify
   ต้องเช็คเพิ่มว่าอยู่ใน denylist ไหม
2. **Allowlist ของ token ที่ยัง valid** (แบบที่โปรเจกต์นี้ทำ) — เก็บ token/jti
   ที่ออกไปแต่ละตัวไว้ใน DB, revoke = ลบ/mark ออกจาก DB

ทั้งสองวิธีทำให้ JWT ไม่ใช่ stateless อีกต่อไป — นี่คือเหตุผลที่บอกว่าพอต้อง
เช็ค DB อยู่ดี การเป็น JWT ก็ไม่ได้ประโยชน์เพิ่มสำหรับ refresh token ของเรา

## Passport คืออะไร

**Passport.js** เป็น authentication middleware มาตรฐานของ Node.js ทำงานแบบ
**strategy pattern** — ไม่ผูกติดกับวิธี auth แบบใดแบบหนึ่ง แต่เปิดให้เสียบ
"strategy" ต่างๆ เข้าไปได้ (JWT, Google OAuth, Local username/password ฯลฯ)
แต่ละ strategy มีหน้าที่เดียว: **ตรวจสอบ credential แล้วบอกว่า user เป็นใคร**

`@nestjs/passport` เป็นตัว wrap Passport ให้ใช้ร่วมกับ NestJS dependency
injection และ decorator ได้สะดวก

## Passport ในโปรเจกต์นี้ทำงานอย่างไร

### [jwt.strategy.ts](src/auth/strategies/jwt.strategy.ts) — บอกวิธีตรวจสอบ JWT

```typescript
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: authConfig.accessSecret,
    });
  }

  validate(payload: JwtPayload) {
    return payload;
  }
}
```

- `Strategy` มาจาก package `passport-jwt` — strategy สำเร็จรูปสำหรับ JWT โดยเฉพาะ
- `jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken()` — หา token จาก
  header `Authorization: Bearer <token>` (มีตัวเลือกอื่น เช่น cookie/query param
  แต่เลือก header เพราะเป็นมาตรฐานสำหรับ mobile app)
- `ignoreExpiration: false` — token หมดอายุ = ปฏิเสธทันที ไม่ปล่อยผ่านให้เช็คเอง
- `secretOrKey: authConfig.accessSecret` — ต้องเป็น secret เดียวกับตอนเซ็น token
  ใน `AuthService.issueTokens` ไม่งั้น verify ไม่ผ่าน
- `validate(payload)` — Passport เรียกหลังจาก verify signature + expiration
  ผ่านแล้วเท่านั้น ค่าที่ return จะถูกแนบเข้า `request.user` ให้ controller ใช้ต่อ

### [jwt-auth.guard.ts](src/auth/guards/jwt-auth.guard.ts) — เอา strategy ไปใช้กับ route

```typescript
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

`AuthGuard('jwt')` บอกว่า "ใช้ strategy ชื่อ `'jwt'`" — ชื่อนี้มาจาก class
`Strategy` ของ `passport-jwt` เองที่ลงทะเบียนตัวเองด้วยชื่อ `'jwt'` ใน Passport's
global registry ตอน instantiate ไม่ได้ตั้งชื่อเอง

ลำดับการทำงานทุกครั้งที่ request มี `@UseGuards(JwtAuthGuard)`:

```
Request เข้ามา
  → JwtAuthGuard ทำงานก่อน controller method
  → เรียก JwtStrategy: ดึง token จาก header
  → verify signature ด้วย secretOrKey + เช็ค exp
  → ผ่าน: เรียก validate(payload) → ใส่ request.user → ปล่อยให้ controller ทำงานต่อ
  → ไม่ผ่าน (signature ผิด/หมดอายุ/ไม่มี token): throw 401 ทันที ไม่เข้า controller เลย
```

### [auth.module.ts](src/auth/auth.module.ts) — ประกอบทุกอย่างเข้าด้วยกัน

```typescript
@Module({
  imports: [PassportModule, JwtModule.register({})],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [PassportModule],
})
```

- `PassportModule` — ให้ NestJS รู้จัก Passport ecosystem
- `JwtModule.register({})` — มาจาก `@nestjs/jwt` (คนละ package กับ `passport-jwt`)
  ให้ `JwtService` ที่ `AuthService` ใช้ตอน **สร้าง/เซ็น** JWT
  ตั้งว่างเปล่าเพราะ secret/expiry ถูกส่งแยกทุกครั้งตอนเรียก `signAsync(...)` เอง
- `exports: [PassportModule]` — ทำให้ module อื่น (เช่น `UsersModule`) import
  `AuthModule` แล้วใช้ `JwtAuthGuard` ได้ ถ้าไม่ export ตัวนี้ Guard จะหา
  strategy ไม่เจอตอนถูกเรียกจาก module อื่น

### สรุปภาพรวม 2 ชั้นที่ทำงานคนละหน้าที่

```
@nestjs/jwt              → "สร้าง/เซ็น" JWT (ตอน login/refresh ใน AuthService)
passport + passport-jwt  → "ตรวจสอบ" JWT ที่แนบมากับ request (ตอนเข้า protected route)
```

สอง package นี้เป็นคนละงานกันแต่ต้องใช้ secret เดียวกัน (`JWT_ACCESS_SECRET`)
เพราะ sign กับ verify ต้องใช้ key เดียวกันถึงจะ match กัน
