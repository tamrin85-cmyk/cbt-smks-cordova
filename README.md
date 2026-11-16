# Aplikasi Ujian Online (CBT) SMKs Cordova - Firebase + Vercel

## Struktur Folder
- `index.html` : Frontend Modern 3D (otomatis terhubung ke `/api/rpc`)
- `api/_firebase.js` : Koneksi Firebase Admin SDK, HMAC token, SHA-256 password, & helper WIB
- `api/rpc.js` : Endpoint Serverless API Vercel pengganti `Kode.gs`
- `firestore.rules` : Aturan keamanan Zero-Trust Firestore
- `vercel.json` : Konfigurasi build & headers Vercel
- `package.json` : Dependensi Node.js (`firebase-admin`)
- `.env.example` : Contoh environment variables

## Langkah Singkat Deploy
1. Buat project di Firebase Console -> aktifkan Firestore Database (mode Production, salin isi `firestore.rules`) -> Project Settings -> Service Accounts -> Generate new private key (file JSON).
2. Upload seluruh isi folder ini ke repository GitHub Anda (jangan upload file JSON key atau `.env`).
3. Import repository GitHub ke Vercel -> tambahkan Environment Variables:
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: isi lengkap file JSON service account
   - `SESSION_SECRET`: string acak minimal 32 karakter
4. Klik Deploy. Login awal Super Admin: `smks` / `Cordova` (segera ganti password di menu Manajemen Pengawas).
