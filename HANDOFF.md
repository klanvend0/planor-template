# Handoff

`README.md` ürünü anlatır. Bu dosya **nerede kaldığımızı** ve lokalde nasıl devam
edeceğini anlatır: ne yeşil, ne açık, ve hangi tuzaklar bir kez ısırdı.

Branch: `claude/coding-language-learning-game-p0i5qf` (push edilmiş).

---

## 1. Durum

Uygulama **.env olmadan da tam çalışır**. Supabase anahtarları yoksa her şey
cihazda döner: giriş "Öğrenmeye başla" olur, ilerleme AsyncStorage'da sunucunun
uygulayacağı kurallarla tutulur, paywall yerel bir hak satar ve para alınmadığını
açıkça söyler, "kodu açıkla" sorusu sorunun kendi anahtar noktalarına göre
puanlanır. Ekranların hiçbiri devre dışı değil.

Yeşil olanlar:

| Komut                     | Kapsam                                                         |
| ------------------------- | -------------------------------------------------------------- |
| `npm run verify`          | tip, format, 216 test, i18n (293 anahtar), 336 soru            |
| `npm run db:check`        | RPC'ler gerçek PostgreSQL'de, 16 test                          |
| `npm run functions:check` | edge fonksiyonlar sahte bir Supabase dünyasına karşı, 111 test |

Ayrıca: `expo export` hem web hem iOS için temiz, ve uygulama tarayıcıda uçtan
uca gezildi (EN/TR, açık/koyu, konsol hatası yok).

---

## 2. Lokalde başlatmak

```bash
git clone <repo> && cd planor-template
git checkout claude/coding-language-learning-game-p0i5qf
npm install

npm run ios        # veya: npm run web / npm run android
```

Gereksinimler:

- **Node 22+** — zorunlu.
- **PostgreSQL 16** — sadece `npm run db:check` için. Script kendi geçici
  cluster'ını kurar (`initdb` + `pg_ctl` PATH'te olmalı; macOS'ta
  `brew install postgresql@16`). Yoksa komut nasıl kurulacağını yazıp 0 ile
  çıkar.
- **Deno 2** — sadece `npm run functions:check` için
  (`curl -fsSL https://deno.land/install.sh | sh`). Yoksa aynı şekilde atlar.

Tek dosyalık önizleme (kurulum istemeyen biri için):

```bash
npx expo export --platform web --output-dir dist
npm run preview:build
cd preview && python3 -m http.server 8000
```

Çift tıklamayla açılmaz — router history API kullanıyor, tarayıcı `file://`
üzerinde buna izin vermiyor. Herhangi bir statik sunucu yeter.

---

## 3. Üç kontrol ne işe yarar

- **`npm run verify`** — her zaman çalışır, ağ istemez. PR öncesi bu.
- **`npm run db:check`** — geçici bir PostgreSQL kurar, iki migration'ı Supabase'in
  verdiği asgari şeyin (auth şeması, üç rol, varsayılan yetkiler) üstüne uygular,
  sonra RPC'lerin ödediğini `lib/scoring.ts` ile karşılaştırır. Ayrıca
  `lib/database.types.ts` ile şemayı ve edge fonksiyonların adını andığı her
  kolonu canlı kataloğa karşı doğrular.
  **Neden var:** PL/pgSQL gövdeyi çağrı anında derler, yani her çağrıda patlayan
  bir fonksiyon sorunsuz kurulur. Bu oturumda tam olarak öyle iki hata bulundu.
- **`npm run functions:check`** — fonksiyonların gerçek handler'larını, GoTrue /
  PostgREST / RevenueCat / AI sağlayıcısının yerine geçen yerel bir sunucuya
  karşı çalıştırır. İstekleri gerçek `supabase-js` kurduğu için iddialar
  fonksiyonun tele koyduğu şey üzerinedir.

---

## 4. .env

`cp .env.example .env` — dosyanın kendisi her değişkenin ne olduğunu ve boş
bırakılırsa ne olacağını anlatıyor. Asgari yol:

1. `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_KEY` → gerçek moda geçer.
2. `npm run supabase:link && npm run supabase:push` → şema.
3. `npm run supabase:secrets:set ...` → AI + RevenueCat + Apple sırları
   (`docs/BACKEND_SETUP.md`).
4. `npm run supabase:functions:push` → webhook'u `--no-verify-jwt` ile.
5. Google/Apple giriş: `docs/OAUTH_SETUP.md` (env değil, Supabase panosu).

Production build'de Supabase değerleri placeholder kalırsa build **kasten**
patlar (`app.config.ts` → `assertShippable`), yani yanlışlıkla demo modda
mağazaya çıkmak mümkün değil.

---

## 5. Taşıyıcı kararlar

Bunlar kodun her yerine yayılmış, değiştirmeden önce nedenini bil:

- **İki mod tek karara bağlı.** `lib/backend_mode.ts` → `USES_LOCAL_BACKEND`.
  Servislerin hepsi bu bayrağın iki tarafını da uygular; `services/local/`
  yedi tablonun yerine geçen tek bir AsyncStorage dokümanıdır.
- **Puanlama kuralları tek yerde.** `lib/scoring.ts`, SQL'in yaptığının aynısını
  yapar; hem çevrimdışı tahmin hem yerel backend oradan okur, `db:check` de ikisini
  karşılaştırır. Kuralı değiştireceksen üçünü birden değiştir.
- **Migration'lar ilk yayına kadar tek "baseline" dosya.** `db push` daha önce
  uyguladığı bir sürümü atladığı için, o dosya kendi eski kopyasının üstüne
  yeniden uygulanabilir olacak şekilde yazıldı (politikalar drop'lu, sonradan
  eklenen kolonlar `add column if not exists`, imzası değişen fonksiyonlar
  baştan drop). **İlk gerçek kullanıcıdan sonra bu kural biter**: her değişiklik
  kendi migration'ına (`npm run supabase:migration:new`).
- **Sandbox satın almalar sayılır.** App Store review ve TestFlight sandbox'ta
  satın alıyor; reddetmek "abone oldum ama hâlâ ücretsiz plandayım" demek olurdu.
  Kapatmak istersen `REVENUECAT_IGNORE_SANDBOX=true`.
- **Edge fonksiyonlar handler'ını export eder**, `Deno.serve` en altta kalır.
  Testler handler'ı doğrudan çağırır; çalışma zamanı hiç değişmedi.

---

## 6. Açık işler

**Yayın öncesi senin dolduracakların** (kod tarafı hazır):

- `EXPO_PUBLIC_TERMS_URL` / `EXPO_PUBLIC_PRIVACY_URL` — placeholder linkler
  App Review'dan döner.
- `IOS_BUNDLE_ID`, `APPLE_TEAM_ID`, App Store Connect'te abonelik ürünleri,
  RevenueCat offering'i (`default`, aylık + yıllık, 3 gün intro).
- `EXPO_PUBLIC_APP_STORE_ID` — ilk gönderimden sonra.
- `docs/APP_STORE.md` içindeki liste bunların hepsini sırasıyla veriyor.

**Test edilemeyenler** (bilerek açık, uydurma kapsam yazmadım):

- Aynı olayın iki kez **eşzamanlı** gelmesi: webhook'un idempotency kontrolü
  SELECT + upsert, atomik değil. Stub istekleri sıraya soktuğu için burada
  kurgulanamıyor; gerçek veritabanı ister.
- Stub gerçek Postgres kısıtlarını uygulamaz (status check, `is_active` generated
  kolonu, FK). `db:check` bunları ayrıca kapsıyor ama ikisi tek testte buluşmuyor.
- Deploy ayarları (`verify_jwt = false`, `Deno.serve` bağlanması) testin
  erişemediği yerde.
- Sabit zamanlı sır karşılaştırmasının **zamanlaması** ölçülmüyor, sadece
  kabul/ret sonucu.

**Ortam notu:** bu container'da `npm run expo:doctor` iki kontrolde patlıyor
(`cdp.expo.dev` ve RN directory'ye ağ politikası izin vermiyor) — proje sorunu
değil, kendi makinende geçmeli.

---

## 7. Bir kez ısıran tuzaklar

- **Web export**: `app.json` → `web.output: "single"`. `"static"` prerender
  sırasında AsyncStorage'a takılıp build'i düşürüyor.
- **NativeWind + Reanimated**: `Animated.*` bileşenlerinde `className` sessizce
  düşer; `lib/nativewind_interop.ts` `cssInterop`'u kaydediyor ve
  `app/_layout.tsx` içinde **ilk** import olmalı.
- **PL/pgSQL**: `returns table (...)` kolon adları fonksiyon içinde değişken
  gibidir. `set total_xp = total_xp + x` belirsizdir ve **çalışma anında**
  patlar. Sağ tarafı tablo adıyla nitele: `game_state.total_xp`.
- **`supabase db push` düzenlenmiş migration'ı atlar** — sürüm numarası zaten
  kayıtlıysa dosyayı bir daha okumaz. Yukarıdaki baseline kuralı bu yüzden var.
- **Deno + jsr**: bazı ağlarda `jsr.io` 403 döner.
  `supabase/functions/_tests/deno.json` içindeki import map `jsr:@supabase/...`
  adresini `npm:` karşılığına çeviriyor; sadece testler için, deploy'a karışmaz.
- **EAS**: bir build profilinin `env` bloğu, EAS environment değişkenlerini
  **ezer**. `eas.json`'da env yok, bilerek; değerler `eas env:create` ile.
- **Playwright + Expo web**: SPA `load` olayını hiç ateşlemez;
  `page.goto(..., { waitUntil: 'commit' })` kullan.

---

## 8. Nerede ne var

| Ne                                    | Nerede                                         |
| ------------------------------------- | ---------------------------------------------- |
| Ekranlar                              | `app/`                                         |
| Ders oturumu durum makinesi           | `hooks/use_lesson_session.ts`                  |
| Puanlama kuralları (tek kaynak)       | `lib/scoring.ts`                               |
| .env yokken çalışan backend           | `services/local/`                              |
| Şema + RPC'ler                        | `supabase/migrations/`                         |
| Edge fonksiyonlar                     | `supabase/functions/`                          |
| Edge fonksiyon testleri + sahte dünya | `supabase/functions/_tests/`                   |
| Şema testleri (gerçek Postgres)       | `supabase/__tests__/schema.test.ts`            |
| Soru bankası (336 soru)               | `content/` (`content/AUTHORING.md`)            |
| İkon üreticisi                        | `scripts/build_icons.mts`                      |
| Kurulum dokümanları                   | `docs/BACKEND_SETUP.md`, `docs/OAUTH_SETUP.md` |
| Yayın listesi                         | `docs/APP_STORE.md`                            |

---

## 9. "Sadece .env ile yayına hazır" ne demek

Kabul kriteri buydu ve şu anda durum şu: kod tarafında eksik yok — uygulama
env'siz çalışır, env'le gerçek backend'e geçer, üç kontrol de yeşil, mağaza
kuralları (3.1.2 paywall açıklaması, 4.8 Apple ile giriş, 5.1.1(v) hesap silme,
gizlilik manifestoları) karşılanmış durumda. Geriye kalan **hesap açma işleri**:
Supabase projesi, RevenueCat ürünleri, Apple/Google giriş kurulumu, gerçek yasal
sayfalar. Hepsi `docs/` altında adım adım yazılı.
