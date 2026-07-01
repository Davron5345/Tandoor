# Bug Report — Приход расход (Mahalla)

> **Senior Code Review** | Sana: 2026-07-01  
> Maqsad: Loyihani xavfsizlik, biznes-mantiq, ma'lumotlar yaxlitligi va kod sifati nuqtai nazaridan tekshirish.

---

## Darajalar

| Daraja | Ma'nosi |
|--------|---------|
| 🔴 **Kritik** | Darhol ishga ta'sir qiladi yoki ma'lumotlarni yo'qotadi |
| 🟠 **Yuqori** | Ombor hisobi yoki moliyaviy hisobni buzadi |
| 🟡 **O'rta** | Xavfsizlik bo'shlig'i yoki biznes-mantiq nosozligi |
| 🟢 **Past** | Ishlash muammosi yoki kod sifati |

---

## 🔴 Kritik muammolar

### 1. Production CORS — har qanday saytga ruxsat beriladi

**Fayl:** `server/corsConfig.js` — qatorlar 38–40  
**Muammo:** `CORS_ORIGIN` env o'rnatilmagan bo'lsa, server har qanday `Origin` ni `credentials: true` bilan qabul qiladi. Bunday holda begona veb-saytlar foydalanuvchi nomidan autentifikatsiyali so'rovlar yuborishi mumkin.  
**Xavf:** Hisob ma'lumotlari o'g'irlanishi, CSRF hujumlari.  
**To'g'ri yechim:**
```js
// Har doim APP_PUBLIC_URL dan olingan aniq origin ishlatilsin
const allowedOrigin = process.env.CORS_ORIGIN || process.env.APP_PUBLIC_URL;
if (!allowedOrigin) throw new Error('CORS_ORIGIN yoki APP_PUBLIC_URL majburiy');
```

---

### 2. `users.edit` huquqi boshqa filiallarda ham foydalanuvchi yaratishga imkon beradi

**Fayl:** `server/routes/org.routes.js` — qatorlar 135–145 | `server/auth.js` — qatorlar 129–245  
**Muammo:** Foydalanuvchi yaratish va yangilash endpointlarida `attachBranch` chaqirilmaydi. Servis ham so'rov yuboruvchining kontekstini olmaydi — shuning uchun filial menedjeri boshqa filiallarga foydalanuvchi qo'sha oladi va ularga yuqori rol berishi mumkin.  
**Xavf:** Ruxsatsiz admin/omborchi hisoblarini yaratish.  
**To'g'ri yechim:** `createUser`/`updateUser` ga so'rov yuboruvchining `branch_id` va roli o'tkazilsin; admin bo'lmasa boshqa filialga yozish bloklansın.

---

### 3. Mahsulotni o'chirish/arxivlash filial chegarasini bilmaydi

**Fayl:** `server/routes/catalog.routes.js` — qatorlar 110–117, 135–141 | `server/services/products.js` — qatorlar 876–903  
**Muammo:** O'chirish va arxivlash routelari `attachBranch` ishlatmaydi; `products.edit` huquqi bo'lgan har qanday omborchi butun tizim bo'yicha mahsulotni arxivlay oladi, boshqa filiallar uchun ham.  
**Xavf:** Boshqa filiallar ombori ishdan chiqishi, menyu elementi yo'qolishi.  
**To'g'ri yechim:** Global arxivlashni faqat `admin` ga ruxsat berish yoki `product_branches` orqali filial bo'yicha ko'rinishni ajratish.

---

## 🟠 Yuqori darajali muammolar

### 4. Qaytarib berish miqdori manba hujjatga nisbatan cheklanmaydi

**Fayl:** `server/services/documents.js` — qatorlar 71–115, 1008–1016, 1198–1207  
**Muammo:** `return_supplier` va `return_customer` manba hujjatning mavjudligini tekshiradi, lekin:
- Qaytarilgan mahsulot miqdori sotib olingan/sotilgan miqdordan oshishi mumkin
- Oldingi qaytarishlar kumulyativ hisobga olinmaydi

**Xavf:** Omborga noto'g'ri stok kiritiladi, kreditor/debitor balansi buziladi, P&L noto'g'ri bo'ladi.  
**Misol:** 10 ta pizza sotildi → 15 ta qaytarib berildi → bu mumkin bo'lib qoladi.  
**To'g'ri yechim:** Har bir qaytarish qatori uchun manba hujjat qatori bilan solishtirish va `SUM(returned_qty) <= source_qty` ni tekshirish.

---

### 5. Noto'g'ri mahsulotni "mijozdan qaytarish" orqali inventarga kiritish mumkin

**Fayl:** `server/services/documents.js` — qatorlar 117–147  
**Muammo:** `findSourceLineMetrics` manba hujjatda mavjud bo'lmagan mahsulot uchun `{ unitCost: 0 }` qaytaradi; chaqiruvchi bu holatni rad etmaydi.  
**Xavf:** Hech qachon sotilmagan mahsulot nol tannarx bilan omborga tushishi mumkin. Bu P&L ni buzadi va inventar hisobini noto'g'ri qiladi.  
**To'g'ri yechim:**
```js
if (!sourceLine) throw new Error('Manba hujjatda bu mahsulot mavjud emas');
```

---

### 6. Filiallar arasi ko'chirma bekor qilinganda qabul qilgan filial salbiy qoladi

**Fayl:** `server/services/documents.js` — qatorlar 238–281  
**Muammo:** `cancelDocument` faqat `assertRazdelkaCanReverse` ni tekshiradi; transfer bekor qilishda `validateTransferStock(reverse=true)` chaqirilmaydi.  
**Xavf:** Qabul qilgan filial tovarni allaqachon ishlatgan bo'lsa, bekor qilish salbiy stok hosil qiladi.  
**Misol:** Filial B → 100 kg un oldi → 80 kg ishlatdi → ko'chirma bekor qilindi → Filial B da −80 kg un.  
**To'g'ri yechim:** Bekor qilishdan avval qabul qiluvchi filialda yetarli stok borligini tekshirish.

---

### 7. Ko'chirma bekor qilinganda tannarx bugungi o'rtacha qiymatdan olinadi, harakatlangandagidan emas

**Fayl:** `server/services/documents.js` — qatorlar 262–267  
**Muammo:** Transfer reversida `getDepartmentAvgCost(targetDept)` joriy vaqtda chaqiriladi.  
**Xavf:** Transfer o'tkazilgan payt va bekor qilingan payt orasida tannarx o'zgargan bo'lsa, manba va maqsad hisoblar noto'g'ri baholanadi.  
**To'g'ri yechim:** Tasdiqlashda `document_items` ga `unit_cost` yozib qo'yish va bekor qilishda o'sha qiymatni ishlatish.

---

### 8. Tasdiqlangan hujjatni tahrirlashda eski stok qaytarilgandan keyin yangi xato bo'lsa noto'g'ri holat qolishi mumkin

**Fayl:** `server/services/documents.js` — qatorlar 1232–1279  
**Muammo:** Tahrirda avval eski harakat qaytariladi, keyin yangi harakat qo'llaniladi. DB tranzaksiyasi ishlatiladi, lekin oldindan validatsiya yetarli emas.  
**Xavf:** Murakkab hollarda qisman mutatsiya foydalanuvchiga ko'rinishi mumkin.  
**To'g'ri yechim:** Har qanday mutatsiyadan avval to'liq validatsiya qilish.

---

### 9. Kassirning 3 kunlik cheklov faqat frontendda — backendda yo'q

**Fayl:** `client/src/permissions.js` — qatorlar 3–24 | `server/routes/finance.routes.js` — qatorlar 52–57  
**Muammo:** `CASHIER_VIEW_DAYS = 3` chegarasi faqat UI da; `GET /api/payments` butun filial bo'yicha barcha to'lovlarni qaytaradi.  
**Xavf:** Kassir API orqali barcha tarixiy operatsiyalarni ko'rishi mumkin.  
**To'g'ri yechim:**
```js
// server/routes/finance.routes.js
if (!hasPermission(user, 'cashier.edit_past')) {
  filters.dateFrom = subDays(new Date(), CASHIER_VIEW_DAYS);
}
```

---

### 10. To'lov raqamlari filiallar orasida unikal bo'lishi mumkin emas

**Fayl:** `server/services/payments.js` — qatorlar 96–103 | `server/db.js` — qatorlar 261–264  
**Muammo:** `generatePaymentNumber(branch)` har filialda 1 dan boshlaydi, lekin `payments.number` ustunda `UNIQUE` constraint bor — bu global.  
**Xavf:** Ikkinchi filial birinchi to'lovini yaratishda conflict xatosi.  
**To'g'ri yechim:**
```sql
-- Mavjud UNIQUE ni olib tashlab yangi constraint qo'shish
CREATE UNIQUE INDEX payments_number_branch ON payments(branch_id, number);
```

---

### 11. Ommaviy shop buyurtmasi endpointida tezlik cheklov va spam himoyasi yo'q

**Fayl:** `server/routes/publicShop.routes.js` — qatorlar 41–57 | `server/shopOrders.js` — qatorlar 149–217  
**Muammo:** Autentifikatsiyasiz buyurtma yaratishda hech qanday: rate limiting, CAPTCHA, maksimal miqdor cheklov, IP bloklash yo'q.  
**Xavf:** Bot hujumlari orqali ming-minglab buyurtmalar, Telegram/Push spam, bazaning to'lib ketishi.  
**To'g'ri yechim:** `express-rate-limit` yoki o'xshash kutubxona bilan IP bo'yicha cheklash:
```js
const limiter = rateLimit({ windowMs: 60_000, max: 10 });
router.post('/orders', limiter, createOrder);
```

---

## 🟡 O'rta darajali muammolar

### 12. Hujjat qatorlarida manfiy/nol miqdor o'tkazilishi mumkin

**Fayl:** `server/services/documents.js` — qatorlar 576–581, 1068–1072  
**Muammo:** `quantity` va `price` uchun faqat `product_id` mavjudligi tekshiriladi; nol, manfiy yoki satr qiymatlari stok hisob-kitobiga tushishi mumkin.  
**To'g'ri yechim:**
```js
if (!Number.isFinite(qty) || qty <= 0) throw new Error('Miqdor musbat bo'lishi shart');
if (!Number.isFinite(price) || price < 0) throw new Error('Narx manfiy bo'lishi mumkin emas');
```

---

### 13. Hujjat sanasi va statusi `req.body` dan ishonib olinadi

**Fayl:** `server/services/documents.js` — qatorlar 1053–1066  
**Muammo:** `date` qiymatining `YYYY-MM-DD` formatda ekanligi tekshirilmaydi; noto'g'ri status qiymatlari DB constraint bilan bloklanadi, lekin foydalanuvchiga tushunarli xato ko'rsatmaydi.  
**To'g'ri yechim:**
```js
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Sana noto'g'ri format: YYYY-MM-DD');
```

---

### 14. Tasdiqlashda tannarx/iste'mol hisoblash tranzaksiya tashqarisida ishlaydi

**Fayl:** `server/services/documents.js` — qatorlar 1323–1334, 1336–1340  
**Muammo:** `applyReturnCustomerLineCosts` va `applyDishSaleConsumption` DB tranzaksiyasidan avval ishlaydi. Keyinchalik status yangilanishi xato bo'lsa, mahsulot qatorlarida o'zgarishlar qoladi.  
**To'g'ri yechim:** Barcha tasdiqlash operatsiyalarini bitta `db.transaction()` ichiga olish.

---

### 15. Cookie sessiyalarda CSRF himoyasi yo'q

**Fayl:** `server/sessionCookie.js` — qatorlar 31–42 | `server/app.js` — qatorlar 45–46  
**Muammo:** Mutatsiyali so'rovlarda (POST/PUT/DELETE) `Origin`/`Referer` tekshiruvi yoki CSRF token yo'q. `SameSite=Lax` to'liq himoya emas.  
**To'g'ri yechim:** Mutatsiyali endpointlarda `Origin` headerini `APP_PUBLIC_URL` bilan solishtirish yoki double-submit cookie pattern ishlatish.

---

### 16. Native bearer token `localStorage` da saqlanadi

**Fayl:** `client/src/utils/nativeApp.js` — qatorlar 29–44  
**Muammo:** WebView `localStorage` dagi token XSS yoki buzilgan WebView kontenti orqali o'g'irlanishi mumkin.  
**To'g'ri yechim:** Capacitor `@capacitor/preferences` (Secure Storage) yoki Android Keystore / iOS Keychain ga o'tish.

---

### 17. Har qanday autentifikatsiyadan o'tgan foydalanuvchi joylashuv yoza oladi

**Fayl:** `server/routes/staff.routes.js` — qatorlar 6–15  
**Muammo:** Joylashuv POST endpointi faqat `requireAuth` talab qiladi. Kassir yoki boshqa rol ham GPS yozib qo'ya oladi.  
**To'g'ri yechim:** `requirePermission('shop_orders.view')` yoki alohida `staff.location` huquqini qo'shish.

---

### 18. Kontragentni o'chirishda bog'liq hujjatlar tekshirilmaydi

**Fayl:** `server/services/counterparties.js` — qatorlar 77–83  
**Muammo:** O'chirish bevosita amalga oshadi; mavjud hujjatlar, to'lovlar, shartnomalar bilan bog'liq kontragent o'chirib yuborilsa, ombor operatsiyalari buziladi.  
**To'g'ri yechim:**
```js
const usages = db.prepare(`SELECT COUNT(*) as cnt FROM documents WHERE counterparty_id = ?`).get(id);
if (usages.cnt > 0) throw new Error('Kontragent hujjatlarda ishlatilmoqda, o\'chirib bo\'lmaydi');
```

---

### 19. Mahsulot yetkazib beruvchi unikalligi filial bo'yicha noto'g'ri

**Fayl:** `server/db.js` — qatorlar 226–234, 1308–1318  
**Muammo:** Jadval boshida `UNIQUE(product_id, supplier_id)` constraint bor, keyinchalik migratsiya `branch_id` qo'shadi, lekin eski constraint bekor qilinmagan.  
**Xavf:** Bir mahsulot turli filiallarda bir xil yetkazib beruvchiga bog'lanishi mumkin emas.  
**To'g'ri yechim:** Migratsiyada eski UNIQUE ni olib, `UNIQUE(product_id, supplier_id, branch_id)` qo'shish.

---

### 20. Admin bo'limlar ro'yxati filial filtrini e'tiborsiz qoldiradi

**Fayl:** `server/routes/org.routes.js` — qatorlar 95–103  
**Muammo:** Admin `branch_id` query parametrsiz so'rasa barcha filiallardagi bo'limlarni oladi, lekin boshqa API'lar `req.branchId` ga asoslanadi.  
**To'g'ri yechim:** Admin uchun ham default `req.branchId` ni ishlatish, faqat maxsus `?all=true` flag bilan hammani qaytarish.

---

## 🟢 Past daraja / Ishlash / Kod sifati

### 21. Ko'plab ro'yxat endpointlarida sahifalash yo'q

**Fayllar:** `server/routes/finance.routes.js` — qatorlar 52–57 | `server/routes/catalog.routes.js` — qatorlar 200–203  
**Muammo:** To'lovlar, hisob-kitoblar, mahsulotlar endpointlari barcha yozuvlarni bir yuklashda qaytaradi. Yirik installyatsiyada bu sezilarli sekinlashuvga olib keladi.  
**To'g'ri yechim:** `server/pagination.js` da mavjud `paginate()` ni barcha ro'yxat endpointlarga qo'llash.

---

### 22. Mahsulot va retseptlarda N+1 so'rov muammosi

**Fayllar:** `server/services/products.js` — qatorlar 168–239, 517–565 | `server/dishSales.js` — qatorlar 34–62  
**Muammo:** Har bir mahsulot uchun variant, rasm, yetkazib beruvchi alohida so'rovda yuklanadi. 500+ mahsulotda bu 1500+ SQL so'rovga teng.  
**To'g'ri yechim:** `WHERE product_id IN (...)` bilan batch-loading ishlatish, keyin JS da guruhlash.

---

### 23. `documents`, `document_items`, `payments` jadvallarida muhim indekslar yo'q

**Fayl:** `server/db.js`  
**Muammo:** Mavjud indekslar: `idx_documents_source_document`, `idx_document_history_document` — bu yetarli emas. Hisobotlar va ro'yxatlar jadvallarni to'liq scan qiladi.  
**Tavsiya etiladigan indekslar:**
```sql
CREATE INDEX idx_docs_branch_type_status_date ON documents(branch_id, type, status, date);
CREATE INDEX idx_docs_from_branch ON documents(from_branch_id, status, date);
CREATE INDEX idx_docs_to_branch ON documents(to_branch_id, status, date);
CREATE INDEX idx_doc_items_doc ON document_items(document_id);
CREATE INDEX idx_payments_branch_date ON payments(branch_id, date, type);
CREATE INDEX idx_payments_counterparty ON payments(counterparty_id);
```

---

### 24. Xatolar aksariyat hollarda 400 bilan qaytariladi

**Fayl:** `server/routes/documents.routes.js` — qatorlar 80–82, 117–119, 147–149  
**Muammo:** Ruxsat yo'qligi (403), topilmadi (404), biznes-mantiq xatosi (409) hammasi 400 bo'lib qaytmoqda.  
**To'g'ri yechim:** Markazlashtirilgan error middleware yaratish:
```js
// 400 = validatsiya | 401 = auth | 403 = permission | 404 = not found | 409 = conflict
```

---

### 25. Muhim stok oqimlari uchun test yetarli emas

**Fayl:** `server/test/`  
**Muammo:** P&L, dish sale, filial kirish testlari mavjud, lekin quyidagilar uchun test yo'q:
- Ortiqcha qaytarish rad etilishi
- Qabul filial tovarni iste'mol qilgandan keyin transfer bekor qilinishi
- Filial bo'yicha foydalanuvchi yaratish/yangilash chegaralari
- Ommaviy buyurtma rate limiting
- To'lov raqami filiallar bo'yicha unikalligi

---

## Xulosa — Eng muhim 5 ta to'g'rilash

| # | Muammo | Daraja |
|---|--------|--------|
| 1 | CORS — har qanday originni qabul qilish | 🔴 Kritik |
| 2 | Qaytarish miqdorini manba bilan solishtirmaslik | 🟠 Yuqori |
| 3 | Kassir vaqt cheklovi faqat frontendda | 🟠 Yuqori |
| 4 | Transfer bekor qilinganda qabul filial salbiy stok | 🟠 Yuqori |
| 5 | Tasdiqlash operatsiyalari bitta tranzaksiyada emas | 🟡 O'rta |

---

*Hisobot muallifi: Senior Code Review (AI agent) | 2026-07-01*
