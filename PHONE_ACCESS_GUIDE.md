# 📱 How to Access SkillHub from Your Phone

## ✅ Changes Made
- Backend now listens on `0.0.0.0` (all network interfaces)
- Frontend auto-detects if running on localhost or network IP
- CORS configured to allow local network connections

## 🚀 Steps to Access from Phone

### 1. Start the Backend
```bash
cd "Skillhub Bn"
npm run dev
```

### 2. Start the Frontend with Live Server
- Open `SkillHub Fn/index.html` in VS Code
- Right-click → "Open with Live Server"
- Live Server will start on port 5500

### 3. Allow Firewall Access (First Time Only)
When you start the backend, Windows Firewall may ask for permission:
- ✅ Check "Private networks" (home/work WiFi)
- ✅ Click "Allow access"

**OR** manually add the rule (run PowerShell as Administrator):
```powershell
New-NetFirewallRule -DisplayName "SkillHub Backend" -Direction Inbound -LocalPort 5000 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "Live Server Frontend" -Direction Inbound -LocalPort 5500 -Protocol TCP -Action Allow
```

### 4. Find Your PC's IP Address
Run this in PowerShell:
```powershell
ipconfig | Select-String "IPv4"
```

Look for an IP like `192.168.x.x` — that's your local network IP.

**Current detected IPs:**
- `192.168.137.1` ← Try this first
- `192.168.40.1` ← Or this
- `10.150.130.122` ← Or this

### 5. Connect from Your Phone
Make sure your phone is on the **same WiFi** as your PC.

Open your phone's browser and go to:
```
http://192.168.137.1:5500
```

Replace `192.168.137.1` with your actual IP if different.

---

## 🌐 Option 2: Deploy Online (For Real Users)

For production access from anywhere (not just your WiFi):

### A. Deploy Backend (Choose One)
1. **Render** (Free tier) — https://render.com
2. **Railway** (Free tier) — https://railway.app
3. **Heroku** (Paid) — https://heroku.com

### B. Deploy Frontend (Choose One)
1. **Netlify** (Free) — https://netlify.com
2. **Vercel** (Free) — https://vercel.com
3. **GitHub Pages** (Free) — https://pages.github.com

### C. Database
Use **MongoDB Atlas** (free tier):
1. Go to https://mongodb.com/cloud/atlas
2. Create free cluster
3. Get connection string
4. Update `.env` → `MONGODB_URI=mongodb+srv://...`

---

## 🔧 Troubleshooting

### Phone can't connect?
1. **Check WiFi**: Phone and PC must be on same network
2. **Check Firewall**: Run as admin:
   ```powershell
   Test-NetConnection -ComputerName localhost -Port 5000
   ```
3. **Check IP**: Your IP might change — run `ipconfig` again
4. **Update script.js**: Change `_localNetworkIP` to your current IP

### Backend says "CORS error"?
The backend is already configured to allow local network IPs (192.168.x.x).
If you still get errors, check the console and update the CORS regex in `server.js`.

### Live Server not accessible from phone?
Live Server settings in VS Code:
1. Open Settings (Ctrl+,)
2. Search "Live Server"
3. Set `Live Server > Settings: Host` to `0.0.0.0`

---

## 📝 Quick Reference

| Service | Local Access | Network Access |
|---------|-------------|----------------|
| Backend API | http://localhost:5000 | http://192.168.137.1:5000 |
| Frontend | http://localhost:5500 | http://192.168.137.1:5500 |
| MongoDB | mongodb://localhost:27017 | (local only) |

---

Need help? Check the console logs for errors.
