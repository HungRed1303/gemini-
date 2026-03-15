# Gemini Image Studio

Web app batch generate ảnh bằng Gemini AI — deploy lên Vercel.

## Tính năng

- Upload ảnh trực tiếp (nhiều file) HOẶC từ file Excel
- Upload file prompt CSV (8 dòng hoặc 8 cột)
- Tự động gen ảnh với từng prompt cho từng ảnh
- Tải từng ảnh hoặc tải tất cả dạng ZIP

---

## Deploy lên Vercel (5 bước)

### 1. Tạo repo GitHub

```bash
git init
git add .
git commit -m "init"
gh repo create gemini-img-gen --public --push
```

Hoặc upload thủ công lên github.com

### 2. Import vào Vercel

- Vào vercel.com → "Add New Project"
- Chọn repo GitHub vừa tạo
- Framework: **Next.js** (tự detect)

### 3. Thêm Environment Variable (tuỳ chọn)

Trong Vercel dashboard → Settings → Environment Variables:

```
GEMINI_API_KEY = AIza...key của bạn...
```

> Nếu không set, user sẽ tự nhập API key trên giao diện.

### 4. Deploy

Nhấn Deploy — xong!

---

## Chạy local

```bash
npm install
cp .env.example .env.local
# Điền API key vào .env.local
npm run dev
```

Mở http://localhost:3000

---

## Cấu trúc file CSV

**Dạng rows (mỗi dòng = 1 prompt):**
```
Make it look like a watercolor painting
Convert to anime style
Add dramatic cinematic lighting
Make it look vintage
Convert to pencil sketch
Add neon cyberpunk colors
Make it an oil painting
Convert to pixel art
```

**Dạng cols (1 dòng, ngăn cách dấu phẩy):**
```
Watercolor,Anime style,Cinematic,Vintage,Pencil sketch,Cyberpunk,Oil painting,Pixel art
```

---

## Cấu trúc Excel (chế độ Excel)

Cột A chứa đường dẫn hoặc tên file ảnh:

| A           |
|-------------|
| anh1.jpg    |
| anh2.png    |
| photo3.webp |

Khi dùng chế độ Excel, bạn cần **upload thêm ảnh** ở tab "Upload Ảnh" — app sẽ tự ghép theo tên file.

---

## Lưu ý

- Model: `gemini-2.0-flash-preview-image-generation`
- Vercel Hobby: timeout 10s/request — nếu Gemini chậm có thể bị timeout → nâng lên Pro (60s)
- Mỗi request có delay 1.5s để tránh rate limit
