# Hướng dẫn triển khai EdgeBridge (End-to-End)

Tài liệu này hướng dẫn triển khai đầy đủ EdgeBridge: từ dựng Gateway ở nhà →
đưa ra Internet → cài Extension trên trình duyệt → kết nối → kiểm tra IP.

> **Phạm vi sử dụng.** EdgeBridge chỉ dùng để kết nối tới gateway mà bạn sở hữu
> hoặc được phép sử dụng (ví dụ truy cập mạng nhà của chính bạn). Đây **không**
> phải công cụ để vượt qua hay né tránh chính sách/kiểm soát mạng của tổ chức.
> Chỉ chạy ở nơi bạn được phép.

Kiến trúc tổng quan:

```text
Extension (máy công ty)
        │  SOCKS5 / HTTP CONNECT (có xác thực)
        ▼
   Internet công cộng
        │
        ▼
  Gateway ở NHÀ (PC/Laptop)
        │
        ▼
     Internet
```

---

## 0. Yêu cầu chuẩn bị

Trên máy chạy Gateway (ở NHÀ):

- **Docker** (khuyến nghị) hoặc **Node.js 18+** nếu chạy trực tiếp.
- Quyền cấu hình router (nếu dùng port forwarding) hoặc một công cụ tunnel.

Trên máy dùng trình duyệt (máy CÔNG TY):

- **Chrome** hoặc **Brave**.

---

## 1. Lấy mã nguồn và cấu hình

Mở terminal tại thư mục dự án:

```bash
cd edgebridge
cp .env.example .env
```

Mở file `.env` và điền giá trị **thật**. Ví dụ tối thiểu:

```dotenv
PORT=1080
HEALTH_PORT=8080
BIND_HOST=0.0.0.0

# Chế độ username/password:
AUTH_MODE=userpass
AUTH_USERS=alice:MatKhauRatManh-123

# ...hoặc chế độ token:
# AUTH_MODE=token
# AUTH_TOKEN=chuoi-ngau-nhien-dai-toi-thieu-8-ky-tu

# Giới hạn nơi proxy được phép kết nối (khuyến nghị):
ALLOWLIST=*.example.com,api.ipify.org,ifconfig.me
ALLOWED_PORTS=80,443

LOG_LEVEL=info
```

Tạo mật khẩu/token mạnh:

```bash
# Linux/macOS
openssl rand -base64 24

# Windows PowerShell
[Convert]::ToBase64String((1..24 | ForEach-Object { Get-Random -Max 256 }))
```

> **Lưu ý bảo mật:** Không commit file `.env`. File này đã được liệt kê trong
> `.gitignore`. Không dùng mật khẩu mặc định trong `.env.example`.

---

## 2. Khởi động Gateway

### Cách A — Docker Compose (khuyến nghị)

```bash
docker compose up -d --build
```

Kiểm tra trạng thái và health:

```bash
docker compose ps
curl http://localhost:8080/health
# Kết quả mong đợi: {"status":"ok","service":"edgebridge-gateway",...}
```

Xem log kết nối (chỉ metadata, không có nội dung traffic):

```bash
docker compose logs -f gateway
```

Dừng lại khi cần:

```bash
docker compose down
```

### Cách B — Chạy trực tiếp bằng Node.js

Trên Linux/macOS:

```bash
cd gateway
set -a; . ../.env; set +a
npm start
```

Trên Windows PowerShell (đặt biến môi trường trực tiếp):

```powershell
$env:AUTH_MODE="userpass"
$env:AUTH_USERS="alice:MatKhauRatManh-123"
$env:ALLOWLIST="*"
node src/index.js
```

Khi thấy log `EdgeBridge gateway listening` và `health server listening` là
Gateway đã chạy thành công.

---

## 3. Kiểm thử Gateway tại chỗ (trước khi expose)

Test nhanh bằng `curl` mà chưa cần extension.

HTTP CONNECT:

```bash
# Chế độ userpass
curl -x http://alice:MatKhauRatManh-123@localhost:1080 https://api.ipify.org

# Chế độ token (username là "token")
curl -x http://token:YOUR_TOKEN@localhost:1080 https://api.ipify.org
```

SOCKS5:

```bash
curl --socks5-hostname alice:MatKhauRatManh-123@localhost:1080 https://api.ipify.org
```

Nếu trả về địa chỉ IP công cộng của mạng nhà bạn, Gateway đang hoạt động đúng.

Thử sai mật khẩu để xác nhận xác thực được thực thi:

```bash
curl -x http://alice:SAI_MAT_KHAU@localhost:1080 https://api.ipify.org
# Mong đợi: lỗi 407 Proxy Authentication Required
```

---

## 4. Đưa Gateway ra Internet

Trình duyệt ở máy công ty phải truy cập được Gateway qua Internet. Chọn phương án
mà bạn được phép sử dụng.

### Phương án 4.1 — Port forwarding trên router (có IP công cộng)

1. Đăng nhập trang quản trị router ở nhà.
2. Thêm rule NAT/Port Forwarding: chuyển cổng ngoài `PORT` (ví dụ `1080`) tới
   địa chỉ IP nội bộ của máy chạy Gateway, cổng `1080`.
3. Ghi lại IP công cộng của bạn (kiểm tra tại `https://api.ipify.org`). Nếu IP
   thay đổi thường xuyên, cân nhắc dùng **Dynamic DNS** để có hostname cố định.
4. Đảm bảo tường lửa Windows/Linux cho phép cổng `1080`.

> **Không** cần forward cổng health (`8080`) ra ngoài — giữ nó ở nội bộ.

### Phương án 4.2 — Cloudflare Tunnel (khuyến nghị, không cần mở cổng router)

Cloudflare Tunnel giúp đưa Gateway ra Internet mà **không cần mở cổng router**,
không cần IP tĩnh, và toàn bộ đường truyền được mã hóa qua mạng Cloudflare.

> **Lưu ý kỹ thuật quan trọng.** EdgeBridge là proxy TCP thô (SOCKS5 / HTTP
> CONNECT). Cloudflare **không** tunnel được giao thức CONNECT thô qua một
> hostname HTTPS thông thường. Vì vậy ta dùng mô hình **TCP tunnel**: chạy
> `cloudflared` ở NHÀ để expose cổng proxy dạng `tcp://`, và chạy `cloudflared`
> ở MÁY CÔNG TY để mở một cổng `localhost`. Extension sẽ trỏ proxy vào
> `localhost:<port>` đó (không phải hostname Cloudflare).
>
> Yêu cầu: một **tên miền** đã được quản lý bởi Cloudflare (thêm domain vào tài
> khoản Cloudflare, đây là bước miễn phí).

#### Bước A — Cài cloudflared trên máy NHÀ (chạy Gateway)

```powershell
# Windows (winget)
winget install --id Cloudflare.cloudflared

# hoặc tải binary tại: https://github.com/cloudflare/cloudflared/releases
```

```bash
# macOS
brew install cloudflared

# Linux (Debian/Ubuntu) - tải .deb từ trang release rồi:
sudo dpkg -i cloudflared-linux-amd64.deb
```

Kiểm tra:

```bash
cloudflared --version
```

#### Bước B — Đăng nhập và tạo tunnel (máy NHÀ)

```bash
# Mở trình duyệt để đăng nhập và cấp quyền cho một domain của bạn
cloudflared tunnel login

# Tạo tunnel tên "edgebridge"
cloudflared tunnel create edgebridge
```

Lệnh `create` sẽ in ra một **Tunnel ID** và tạo file credentials (dạng
`~/.cloudflared/<TUNNEL_ID>.json`, trên Windows là
`C:\Users\<user>\.cloudflared\<TUNNEL_ID>.json`). Ghi lại đường dẫn này.

#### Bước C — Gán một hostname (subdomain) cho tunnel (máy NHÀ)

```bash
# Trỏ subdomain về tunnel; thay bằng domain thật của bạn
cloudflared tunnel route dns edgebridge eb.yourdomain.com
```

#### Bước D — Tạo file cấu hình tunnel (máy NHÀ)

Tạo file `config.yml` trong thư mục `.cloudflared`:

- Windows: `C:\Users\<user>\.cloudflared\config.yml`
- macOS/Linux: `~/.cloudflared/config.yml`

Nội dung (thay `TUNNEL_ID` và đường dẫn credentials cho đúng):

```yaml
tunnel: TUNNEL_ID
credentials-file: /duong/dan/toi/TUNNEL_ID.json

ingress:
  # Ánh xạ hostname công khai -> cổng proxy nội bộ của Gateway
  - hostname: eb.yourdomain.com
    service: tcp://localhost:1080
  # Bắt buộc phải có rule fallback cuối cùng
  - service: http_status:404
```

> Lưu ý: `service: tcp://localhost:1080` trỏ tới **cổng proxy** (PORT), không
> phải cổng health. Không expose cổng health qua tunnel.

#### Bước E — Chạy tunnel (máy NHÀ)

Chạy thử ở foreground:

```bash
cloudflared tunnel run edgebridge
```

Cài chạy nền như một service (khuyến nghị để tự bật khi khởi động máy):

```bash
# Windows (chạy PowerShell as Administrator)
cloudflared service install

# macOS/Linux
sudo cloudflared service install
```

Đảm bảo Gateway (Docker) vẫn đang chạy song song với tunnel.

#### Bước F — Cài cloudflared trên MÁY CÔNG TY và mở cổng cục bộ

Trên máy công ty, cài `cloudflared` (như Bước A), rồi mở một cổng localhost
kết nối tới tunnel:

```bash
cloudflared access tcp --hostname eb.yourdomain.com --url localhost:1080
```

Lệnh này giữ chạy và tạo một listener tại `localhost:1080` trên máy công ty,
chuyển tiếp mã hóa qua Cloudflare về Gateway ở nhà.

#### Bước G — Trỏ Extension vào localhost

Vì `cloudflared access` mở cổng cục bộ, trong popup EdgeBridge bạn điền:

- **Gateway host:** `localhost` (hoặc `127.0.0.1`)
- **Gateway port:** `1080` (cổng đã mở ở Bước F)
- **Proxy protocol / Authentication:** như trong `.env`

Kiểm tra nhanh từ máy công ty (dùng `curl.exe` trên Windows PowerShell):

```bash
curl.exe -x http://alice:MatKhauCuaBan@localhost:1080 https://api.ipify.org
```

Nếu trả về IP của mạng nhà bạn, tunnel Cloudflare đã hoạt động end-to-end.

---

### Phương án 4.3 — ngrok (thay thế nhanh, không cần domain)

Nếu chỉ cần nhanh và không có domain, dùng ngrok tunnel TCP tới cổng proxy:

```bash
ngrok tcp 1080
```

ngrok sẽ cấp một địa chỉ dạng `tcp://0.tcp.ngrok.io:XXXXX`. Dùng host và port đó
điền trực tiếp vào extension (không cần chạy client phía máy công ty).

---

### Checklist bảo mật khi expose

- Giữ `AUTH_MODE` bật và dùng thông tin đăng nhập/token đủ mạnh.
- Đặt `ALLOWLIST` càng hẹp càng tốt và `ALLOWED_PORTS=80,443`.
- Không expose cổng health ra Internet.
- Ưu tiên đặt proxy sau một tunnel có TLS/hostname riêng.

### Kiểm tra truy cập từ xa

Từ một mạng khác (ví dụ máy công ty), kiểm tra proxy hoạt động. Địa chỉ dùng để
test tùy theo phương án expose ở trên:

- **Port forwarding / ngrok:** dùng host và port công khai.

  ```bash
  # Windows PowerShell dùng curl.exe (curl là alias của Invoke-WebRequest)
  curl.exe -x http://alice:MatKhauCuaBan@<PUBLIC_HOST>:<PORT> https://api.ipify.org
  ```

- **Cloudflare Tunnel:** proxy được mở tại `localhost` bởi `cloudflared access`
  (xem Bước F/G), nên test qua localhost:

  ```bash
  curl.exe -x http://alice:MatKhauCuaBan@localhost:1080 https://api.ipify.org
  ```

> Trên Windows PowerShell hãy gọi `curl.exe` (không phải `curl`) và trên
> Linux/macOS dùng `curl`. Nếu trả về IP của mạng nhà bạn là đã thành công.

---

## 5. Cài Extension trên Chrome / Brave (máy công ty)

1. Mở `chrome://extensions` (Chrome) hoặc `brave://extensions` (Brave).
2. Bật **Developer mode** (góc trên bên phải).
3. Nhấn **Load unpacked** và chọn thư mục `edgebridge/extension`.
4. Ghim biểu tượng **EdgeBridge** lên thanh công cụ.

---

## 6. Cấu hình và Kết nối

Nhấn biểu tượng EdgeBridge và điền:

- **Gateway host** — IP công cộng hoặc hostname tunnel của bạn.
- **Gateway port** — cổng `PORT` đã expose (ví dụ `1080`).
- **Proxy protocol** — **HTTP CONNECT** (khuyến nghị) hoặc SOCKS5.
- **Authentication** — Username/Password hoặc Token, khớp với `.env`.

Nhấn **Connect**. Chấm trạng thái chuyển xanh và badge hiện `ON`.

> **Vì sao khuyến nghị HTTP CONNECT?** Chrome/Brave có thể tự động cung cấp
> username/password cho proxy qua cơ chế xác thực của trình duyệt. Với SOCKS5,
> Chromium không tự bơm được thông tin đăng nhập từ extension.

### Ngắt kết nối

Nhấn **Disconnect**. EdgeBridge xóa cấu hình proxy của nó và khôi phục lại cấu
hình proxy trước đó của trình duyệt. Badge sẽ mất chữ `ON`.

---

## 7. Kiểm tra traffic đã đi qua Gateway (test IP)

1. **Trước khi Connect:** mở `https://api.ipify.org` hoặc `https://ifconfig.me/ip`
   trong trình duyệt và ghi lại IP (đây là IP mạng công ty).
2. Nhấn **Connect**.
3. **Sau khi Connect:** tải lại trang IP. Địa chỉ hiển thị bây giờ phải là IP
   của Gateway ở nhà bạn.

Nếu IP sau khi kết nối trùng với IP nhà bạn, traffic đã đi qua Gateway thành công.

> Nếu bạn đặt `ALLOWLIST`, nhớ thêm host kiểm tra IP vào danh sách (ví dụ
> `api.ipify.org`, `ifconfig.me`), nếu không request sẽ bị chặn.

Bạn cũng có thể đối chiếu ở log Gateway — mỗi phiên tunnel in ra một dòng
`socks5 connect` / `http connect` kèm địa chỉ đích (không có nội dung).

---

## 8. Vận hành và bảo trì

- **Xem log:** `docker compose logs -f gateway`
- **Khởi động lại:** `docker compose restart gateway`
- **Cập nhật cấu hình:** sửa `.env` rồi `docker compose up -d` để áp dụng.
- **Nâng cấp mã nguồn:** `docker compose up -d --build`
- **Tự chạy khi bật máy:** `docker-compose.yml` đã đặt
  `restart: unless-stopped`, container sẽ tự khởi động lại.

---

## 9. Xử lý sự cố

| Triệu chứng | Nguyên nhân / cách khắc phục |
| --- | --- |
| Gateway không khởi động, log `[FATAL] Configuration error` | Thiếu cấu hình xác thực. Kiểm tra `AUTH_MODE`, `AUTH_USERS`/`AUTH_TOKEN` trong `.env`. |
| `curl /health` lỗi | Health chỉ chạy nội bộ (không expose ra ngoài là đúng thiết kế). Test tại chỗ hoặc test cổng proxy thay vì cổng health. |
| Popup báo "Failed to apply proxy settings" | Một extension khác đang chiếm cấu hình proxy, hoặc trình duyệt bị quản lý bởi policy. Tắt extension proxy đang xung đột. |
| Trang lỗi xác thực proxy (407) | Sai username/password/token, hoặc `AUTH_MODE` không khớp. Kiểm tra lại `.env` và popup. |
| Log báo `403 Forbidden` / bị từ chối | Đích không nằm trong `ALLOWLIST`, hoặc cổng không thuộc `ALLOWED_PORTS`. |
| IP không đổi sau khi Connect | Đích bị bỏ qua (localhost/nội bộ), hoặc kết nối chưa áp dụng. Kiểm tra badge = `ON` và thử một trang web bên ngoài. |
| Không kết nối được từ máy công ty | Chưa forward cổng / tunnel chưa chạy / tường lửa chặn. Kiểm tra lại bước 4. |

---

## 10. Gỡ bỏ

Trên máy Gateway:

```bash
docker compose down
```

Trên trình duyệt: vào trang extensions, xóa EdgeBridge (thao tác này cũng khôi
phục cấu hình proxy về mặc định).

---

## Phụ lục A — Triển khai End-to-End với Cloudflare Tunnel (đã có domain)

Đây là quy trình liền mạch từ đầu đến cuối cho ai đã có sẵn domain trên
Cloudflare. Làm tuần tự các bước dưới đây là chạy được. Giả sử:

- Domain: `yourdomain.com` (đã add vào Cloudflare, nameserver trỏ về Cloudflare).
- Hostname sẽ dùng: `eb.yourdomain.com`.
- Cổng proxy nội bộ: `1080` (giá trị `PORT` trong `.env`).
- Chế độ auth ví dụ: `userpass` với user `alice`.

Mô hình hoạt động:

```text
Trình duyệt (máy công ty)
   → proxy tới localhost:1080
       → cloudflared access (máy công ty)  ── mã hóa ──┐
                                                        ▼
                                             Mạng Cloudflare (eb.yourdomain.com)
                                                        │
                                                        ▼
                          cloudflared tunnel (máy NHÀ) → tcp://localhost:1080
                                                        │
                                                        ▼
                                           EdgeBridge Gateway (Docker) → Internet
```

> Vì EdgeBridge là proxy TCP thô (SOCKS5/HTTP CONNECT), ta dùng **TCP tunnel**:
> cần chạy `cloudflared` ở CẢ máy nhà và máy công ty. Extension trỏ vào
> `localhost`, không phải `eb.yourdomain.com` trực tiếp.

---

### PHẦN 1 — Trên máy NHÀ (nơi chạy Gateway)

**1. Bật Gateway (nếu chưa chạy):**

```bash
cd edgebridge
docker compose up -d
curl http://localhost:8080/health   # kỳ vọng: {"status":"ok",...}
```

**2. Cài cloudflared:**

```powershell
# Windows
winget install --id Cloudflare.cloudflared
```

```bash
# macOS
brew install cloudflared
# Linux: tải .deb tại https://github.com/cloudflare/cloudflared/releases rồi
sudo dpkg -i cloudflared-linux-amd64.deb
```

**3. Đăng nhập Cloudflare (mở trình duyệt, chọn domain của bạn):**

```bash
cloudflared tunnel login
```

**4. Tạo tunnel tên `edgebridge`:**

```bash
cloudflared tunnel create edgebridge
```

Ghi lại **Tunnel ID** và đường dẫn file credentials `<TUNNEL_ID>.json` mà lệnh
in ra (thường trong `~/.cloudflared/` hoặc `C:\Users\<user>\.cloudflared\`).

**5. Trỏ DNS subdomain về tunnel:**

```bash
cloudflared tunnel route dns edgebridge eb.yourdomain.com
```

Lệnh này tự tạo một bản ghi CNAME `eb` trong DNS Cloudflare của bạn.

**6. Tạo file cấu hình** `~/.cloudflared/config.yml`
(Windows: `C:\Users\<user>\.cloudflared\config.yml`):

```yaml
tunnel: <TUNNEL_ID>
credentials-file: C:\Users\<user>\.cloudflared\<TUNNEL_ID>.json

ingress:
  - hostname: eb.yourdomain.com
    service: tcp://localhost:1080
  - service: http_status:404
```

> Thay `<TUNNEL_ID>` và đường dẫn credentials cho đúng. `service` phải là
> `tcp://localhost:1080` (cổng proxy), tuyệt đối không trỏ cổng health.

**7. Chạy tunnel (foreground để test trước):**

```bash
cloudflared tunnel run edgebridge
```

Khi thấy log kết nối 4 edge của Cloudflare là tunnel đã lên. Để dừng: Ctrl+C.

**8. Cài chạy nền như service (để tự bật cùng máy):**

```bash
# Windows: mở PowerShell as Administrator
cloudflared service install

# macOS/Linux
sudo cloudflared service install
```

Đến đây phía nhà đã sẵn sàng: Gateway + tunnel đều chạy.

---

### PHẦN 2 — Trên máy CÔNG TY (nơi dùng trình duyệt)

**9. Cài cloudflared** (giống bước 2).

**10. Mở cổng cục bộ nối tới tunnel** (giữ cửa sổ này chạy):

```bash
cloudflared access tcp --hostname eb.yourdomain.com --url localhost:1080
```

Lệnh này tạo listener tại `localhost:1080` trên máy công ty và chuyển tiếp
(mã hóa) về Gateway ở nhà qua Cloudflare.

> Muốn cổng cục bộ khác (nếu 1080 đã bận), đổi `--url localhost:1085` chẳng hạn,
> và nhớ dùng đúng cổng đó ở bước 12.

**11. Kiểm tra end-to-end bằng curl** (Windows dùng `curl.exe`):

```bash
curl.exe -x http://alice:MatKhauCuaBan@localhost:1080 https://api.ipify.org
```

Nếu trả về IP của mạng NHÀ bạn → toàn tuyến Cloudflare đã thông.

**12. Cấu hình Extension:**

- **Gateway host:** `localhost`
- **Gateway port:** `1080` (hoặc cổng đã chọn ở bước 10)
- **Proxy protocol:** HTTP CONNECT (khuyến nghị)
- **Authentication:** khớp với `.env` (ví dụ user `alice`)
- Nhấn **Connect** → badge hiện `ON`.

**13. Xác nhận IP:** mở `https://api.ipify.org` trong trình duyệt trước và sau
khi Connect. Sau khi Connect phải hiện IP của nhà bạn.

---

### Xử lý sự cố riêng cho Cloudflare

| Triệu chứng | Nguyên nhân / cách khắc phục |
| --- | --- |
| `tunnel credentials file not found` | Sai đường dẫn `credentials-file` trong `config.yml`. Kiểm tra lại tên file `<TUNNEL_ID>.json`. |
| `failed to sufficiently increase receive buffer size` (cảnh báo) | Chỉ là cảnh báo QUIC/UDP, tunnel vẫn chạy. Có thể bỏ qua. |
| `cloudflared access tcp` báo lỗi 1033 hoặc không kết nối | Tunnel phía nhà chưa chạy, hoặc DNS `eb.yourdomain.com` chưa trỏ đúng. Kiểm tra `cloudflared tunnel run` ở nhà và bản ghi CNAME. |
| Mạng công ty chặn `cloudflared access` | Cổng ra bị chặn. Cloudflare ưu tiên QUIC/UDP 7844; thử thêm `--url` qua HTTP2 bằng biến `TUNNEL_TRANSPORT_PROTOCOL=http2`. Nếu vẫn bị chặn, đây là chính sách mạng — không tìm cách vượt qua. |
| Trình duyệt vẫn ra IP công ty | Extension chưa Connect, hoặc host/port sai. Đảm bảo trỏ `localhost:1080` đúng cổng ở bước 10 và badge = `ON`. |
| `curl.exe` báo 407 | Sai thông tin đăng nhập so với `.env`. |

---

### Dừng / gỡ Cloudflare Tunnel

```bash
# Máy công ty: chỉ cần Ctrl+C cửa sổ "cloudflared access"

# Máy nhà: gỡ service (nếu đã cài)
cloudflared service uninstall     # macOS/Linux thêm sudo

# Xóa hẳn tunnel (tùy chọn)
cloudflared tunnel delete edgebridge
```

> **Nhắc lại phạm vi sử dụng:** chỉ dùng EdgeBridge với gateway bạn sở hữu/được
> phép và trong môi trường được phép; không dùng để vượt qua kiểm soát mạng của
> tổ chức.

---

## Phụ lục B — Tạo Tunnel bằng giao diện Cloudflare (Zero Trust Dashboard)

Cách này quản lý tunnel **từ xa qua giao diện web** (remotely-managed tunnel):
bạn tạo tunnel trên dashboard, lấy một **token**, rồi chỉ cần chạy connector
bằng token đó ở máy nhà — không phải tự viết `config.yml`.

Giả định như Phụ lục A: domain `yourdomain.com`, hostname `eb.yourdomain.com`,
cổng proxy nội bộ `1080`.

> Lưu ý mô hình vẫn là **TCP tunnel hai đầu** (EdgeBridge là proxy TCP thô):
> UI dùng để dựng connector phía nhà; phía máy công ty vẫn chạy
> `cloudflared access tcp` và extension trỏ vào `localhost`.

---

### PHẦN 1 — Tạo tunnel trên giao diện web (làm 1 lần)

1. Mở **Cloudflare Zero Trust Dashboard**: <https://one.dash.cloudflare.com>
   (nếu chưa có, chọn team name để khởi tạo Zero Trust — gói Free là đủ).

2. Vào menu trái: **Networks → Tunnels** (ở một số giao diện là
   **Access → Tunnels**).

3. Nhấn **Create a tunnel**.

4. Chọn loại connector: **Cloudflared** → **Next**.

5. Đặt tên tunnel, ví dụ `edgebridge` → **Save tunnel**.

6. Màn hình **Install and run a connector** hiện ra. Chọn hệ điều hành của máy
   NHÀ (Windows/macOS/Linux). Dashboard sẽ hiện sẵn một lệnh cài kèm token, dạng:

   ```bash
   cloudflared service install eyJhIjoi....(token rất dài)....
   ```

   **Sao chép nguyên lệnh này** (hoặc chỉ phần token). Nhấn **Next**.

7. Bước **Route Traffic / Public Hostname**: khai báo hostname công khai trỏ về
   Gateway:

   - **Subdomain:** `eb`
   - **Domain:** chọn `yourdomain.com`
   - **Path:** để trống
   - **Type:** chọn **TCP**
   - **URL:** `localhost:1080`

   Nhấn **Save**.

   > Nếu giao diện không cho chọn Type = TCP ở mục Public Hostname, hãy tạo
   > tunnel trước (chỉ tới bước lấy token), rồi vào lại tunnel vừa tạo →
   > **Configure → Public Hostname → Add a public hostname** để thêm với
   > Type = TCP, URL `localhost:1080`.

---

### PHẦN 2 — Chạy connector ở máy NHÀ

8. Đảm bảo Gateway đang chạy:

   ```bash
   cd edgebridge
   docker compose up -d
   curl http://localhost:8080/health
   ```

9. Cài `cloudflared` (nếu chưa có):

   ```powershell
   # Windows
   winget install --id Cloudflare.cloudflared
   ```

   ```bash
   # macOS
   brew install cloudflared
   ```

10. Chạy connector bằng lệnh (token) đã copy ở bước 6. Cách này cài luôn thành
    service tự khởi động:

    ```bash
    # Windows: mở PowerShell as Administrator
    cloudflared service install <TOKEN>

    # macOS/Linux
    sudo cloudflared service install <TOKEN>
    ```

    Hoặc chỉ chạy tạm ở foreground để test:

    ```bash
    cloudflared tunnel run --token <TOKEN>
    ```

11. Quay lại dashboard, mục **Networks → Tunnels**. Tunnel `edgebridge` phải hiện
    trạng thái **HEALTHY** (chấm xanh). Nếu vẫn `DOWN`, xem lại token và kết nối
    mạng của máy nhà.

---

### PHẦN 3 — Kết nối từ máy CÔNG TY

Giống Phụ lục A: connector phía nhà chỉ đưa proxy lên Cloudflare, còn phía máy
công ty vẫn cần mở cổng cục bộ.

12. Cài `cloudflared` trên máy công ty.

13. Mở cổng localhost nối tới tunnel (giữ cửa sổ chạy):

    ```bash
    cloudflared access tcp --hostname eb.yourdomain.com --url localhost:1080
    ```

14. Test end-to-end (Windows dùng `curl.exe`):

    ```bash
    curl.exe -x http://alice:MatKhauCuaBan@localhost:1080 https://api.ipify.org
    ```

    Trả về IP của mạng nhà là thành công.

15. Cấu hình Extension: **host = `localhost`**, **port = `1080`**, auth khớp
    `.env`, nhấn **Connect** và kiểm tra IP như mục 7 của tài liệu chính.

---

### Sửa cấu hình sau này (qua UI)

Vì đây là tunnel quản lý từ xa, mọi thay đổi hostname/route làm trực tiếp trên
dashboard: **Networks → Tunnels → chọn `edgebridge` → Configure → Public
Hostname**. Không cần sửa file trên máy nhà; connector tự nhận cấu hình mới.

### So sánh nhanh hai cách tạo tunnel

| | Phụ lục A (CLI + config.yml) | Phụ lục B (UI + token) |
| --- | --- | --- |
| Quản lý cấu hình | File `config.yml` trên máy nhà | Dashboard web |
| Đổi route | Sửa file, restart | Sửa trên UI, tự áp dụng |
| Phù hợp khi | Thích kiểm soát bằng file/IaC | Thích thao tác trực quan |

Cả hai cách đều cần `cloudflared access tcp` ở máy công ty và extension trỏ
`localhost` — vì EdgeBridge là proxy TCP thô.

---

## Phụ lục C — Máy công ty dùng CMD, không có quyền admin

Áp dụng khi máy công ty: **chạy được `cmd.exe`** và **chạy được `cloudflared.exe`**,
nhưng **không có quyền admin** và **không dùng PowerShell**.

Tin tốt: phía máy công ty **không cần quyền admin**. Lệnh `cloudflared access tcp`
chỉ mở một listener ở `localhost` và `curl.exe` có sẵn trên Windows — tất cả
chạy được bằng cmd thường. Ta cũng **không cài service** (việc cần admin), mà
chạy `cloudflared.exe` ở dạng portable.

> Phần cấu hình phía NHÀ giữ nguyên như Phụ lục A hoặc B (máy nhà là của bạn,
> có quyền cài đặt). Phụ lục này chỉ thay các bước phía MÁY CÔNG TY.

### 1. Tải cloudflared.exe (không cần cài đặt)

Tải file `cloudflared-windows-amd64.exe` từ trang release chính thức:
<https://github.com/cloudflare/cloudflared/releases>

Đổi tên cho gọn thành `cloudflared.exe` và đặt vào một thư mục bạn có quyền ghi,
ví dụ `C:\Users\<user>\edgebridge\`. Không cần chạy installer.

### 2. Mở cổng cục bộ bằng cmd (giữ cửa sổ này chạy)

Mở **Command Prompt** (cmd.exe), chuyển vào thư mục chứa file rồi chạy:

```cmd
cd C:\Users\<user>\edgebridge
cloudflared.exe access tcp --hostname eb.yourdomain.com --url localhost:1080
```

Lệnh này chạy ở foreground và tạo listener tại `localhost:1080`. **Giữ nguyên
cửa sổ cmd này** trong suốt phiên làm việc; đóng cửa sổ là tunnel cục bộ tắt.

> Lần đầu chạy, Windows có thể hỏi Firewall cho ứng dụng. Cho phép ở phạm vi
> mạng của bạn. Nếu bị chặn hoàn toàn thì đó là chính sách mạng — không tìm cách
> vượt qua.
>
> Nếu cổng `1080` đã bận, đổi sang cổng khác, ví dụ `--url localhost:1085`, và
> nhớ dùng đúng `1085` ở bước test và trong extension.

### 3. Kiểm tra bằng curl.exe (cmd, không cần admin)

Mở một cửa sổ cmd **thứ hai** (cửa sổ đầu vẫn để chạy cloudflared):

```cmd
curl.exe -x http://alice:MatKhauCuaBan@localhost:1080 https://api.ipify.org
```

Nếu trả về IP mạng nhà bạn là toàn tuyến đã thông.

> Trong cmd, `curl` chính là `curl.exe` thật (khác PowerShell nơi `curl` là
> alias của Invoke-WebRequest). Dùng `curl` hay `curl.exe` trong cmd đều được.

### 4. Cấu hình Extension

- **Gateway host:** `localhost`
- **Gateway port:** `1080` (hoặc cổng đã chọn ở bước 2)
- **Proxy protocol:** HTTP CONNECT
- **Authentication:** khớp `.env`
- Nhấn **Connect** → kiểm tra IP như mục 7 của tài liệu chính.

### 5. (Tùy chọn) Tạo file .bat để mở nhanh mỗi lần dùng

Tạo file `start-edgebridge.bat` trong cùng thư mục, nội dung:

```bat
@echo off
cd /d "%~dp0"
cloudflared.exe access tcp --hostname eb.yourdomain.com --url localhost:1080
```

Nhấp đúp file `.bat` này để mở cổng cục bộ mà không cần gõ lệnh. Không cần admin.

### Lưu ý về "không admin"

| Việc | Cần admin? | Ghi chú |
| --- | --- | --- |
| Chạy `cloudflared.exe access tcp` | Không | Chỉ mở listener localhost |
| Chạy `curl.exe` | Không | Có sẵn trên Windows |
| Tạo/chạy file `.bat` | Không | |
| `cloudflared service install` | **Có** | KHÔNG dùng ở máy công ty; chỉ cài service ở máy nhà |
| Sửa cấu hình proxy trình duyệt qua Extension | Không | Extension tự quản lý ở tầng trình duyệt |
