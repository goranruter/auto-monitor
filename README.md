# 🚗 Auto Monitor - Uputstvo za podešavanje

## Šta ovo radi
Svakih 30 minuta proverava 18 najpopularnijih modela na polovniautomobili.rs,
AI analizira cene i šalje email na goranruter1@gmail.com kad pronađe
oglas sa Deal Score ≥ 80 (tj. značajno ispod tržišne vrednosti).

---

## Korak 1 — Napravi GitHub repo

1. Idi na https://github.com/new
2. Naziv: `auto-monitor` (može biti private)
3. Klikni **Create repository**
4. Upload-uj sve fajlove iz ovog ZIP-a

Struktura treba da izgleda ovako:
```
auto-monitor/
├── .github/
│   └── workflows/
│       └── car-monitor.yml
├── scripts/
│   └── monitor.js
├── seen_listings.json
└── package.json
```

---

## Korak 2 — Dodaj GitHub Secrets

Idi na: **Settings → Secrets and variables → Actions → New repository secret**

Dodaj 3 secreta:

| Naziv | Vrednost |
|-------|----------|
| `ANTHROPIC_API_KEY` | Tvoj Anthropic API ključ (https://console.anthropic.com) |
| `GMAIL_USER` | Gmail adresa sa koje se šalju emailovi (npr. neka druga adresa) |
| `GMAIL_APP_PASSWORD` | Gmail App Password (vidi Korak 3) |

---

## Korak 3 — Gmail App Password

Da bi nodemailer mogao slati email, treba ti **App Password** (ne obična lozinka):

1. Idi na https://myaccount.google.com/security
2. Uključi **2-Step Verification** ako nije uključeno
3. Idi na **App passwords** (https://myaccount.google.com/apppasswords)
4. Naziv: `auto-monitor`, klikni **Create**
5. Kopiraj 16-cifreni kod — to je `GMAIL_APP_PASSWORD`

> **Napomena:** `GMAIL_USER` je adresa SA koje se šalje (može biti ista goranruter1@gmail.com,
> ili neka druga). Email uvek stiže na goranruter1@gmail.com.

---

## Korak 4 — Test

1. Idi na **Actions** tab u svom repo-u
2. Klikni na **Polovni Automobili - Monitor Povoljnih Oglasa**
3. Klikni **Run workflow** → **Run workflow**
4. Prati log — za ~5 min treba da vidiš rezultat

---

## Troškovi

- **GitHub Actions**: besplatno (2000 min/mesec na free planu)
  - Svakih 30 min = ~48 pokretanja/dan = ~1440/mesec ≈ 720 min/mesec ✅
- **Anthropic API**: ~$0.01-0.05 po pokretanju zavisno od broja oglasa
  - ~$15-75/mesec ako radi non-stop (možeš smanjiti na "Svaki sat" da uštediš)

---

## Praćeni modeli

VW Golf, VW Passat, BMW Serija 3 i 5, Audi A4 i A6,
Mercedes C i E klasa, Skoda Octavia, Toyota Camry i RAV4,
Ford Focus, Opel Insignia, Hyundai Tucson, Kia Sportage,
Mazda CX-5, Peugeot 508, Renault Megane

Sve cene: minimum **10.000 €**
Notifikacija: Deal Score **≥ 80/100**
