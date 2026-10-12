# Khai-Agents

Khai là workspace AI agent để giao việc trực tiếp trên dự án: đọc và sửa mã nguồn, chạy lệnh, kiểm tra kết quả, nghiên cứu và tạo tài liệu. Ứng dụng có giao diện web, desktop và dịch vụ gateway dùng chung.

## Tính năng

- Làm việc với thư mục dự án trong workspace riêng; xem lại các thay đổi trước khi dùng.
- Chọn nhà cung cấp và model AI, đặt giới hạn chi phí và theo dõi hoạt động của agent.
- Tìm kiếm web, đọc mã nguồn và tổng hợp câu trả lời có dẫn nguồn.
- Tạo và xem trước tài liệu, bảng tính, PDF và slide.
- Ghi chú, lịch, kế hoạch và KhaiDocs trong cùng workspace.
- Gateway hỗ trợ tài khoản, đăng nhập, đăng ký và quản trị người dùng.

## Các trang của ứng dụng

- `/` — landing page.
- `/app` — đăng nhập hoặc tạo tài khoản.

Tài khoản đầu tiên đăng ký trên một database mới sẽ trở thành quản trị viên. Các tài khoản đăng ký sau cần quản trị viên duyệt.

## Chạy local từ source

Yêu cầu Python 3.12+, Node.js 22+ và Docker. Ví dụ dưới đây dùng Colima trên macOS.

### 1. Khởi động các dịch vụ dữ liệu

```sh
./docker/stack/up.sh
```

Lệnh này khởi động PostgreSQL, Redis và Qdrant, đồng thời tạo `docker/stack/.env` khi chạy lần đầu.

### 2. Cài dependencies và build giao diện

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm --prefix desktop ci
npm --prefix desktop run build:web
```

### 3. Chạy gateway trên cổng 8090

Chạy trong shell ở thư mục gốc của repo:

```sh
set -a
. docker/stack/.env
set +a

export KHAI_DATABASE_URL="postgresql://khai:${KHAI_PG_APP_PASSWORD}@127.0.0.1:${KHAI_PG_PORT:-5452}/khai"
export KHAI_REDIS_URL="redis://:${KHAI_REDIS_PASSWORD}@127.0.0.1:${KHAI_REDIS_PORT:-6392}/0"
export KHAI_QDRANT_URL="http://127.0.0.1:${KHAI_QDRANT_PORT:-6353}"
export KHAI_QDRANT_API_KEY
export KHAI_PUBLIC_ORIGIN="http://127.0.0.1:8090"
export KHAI_BIND_HOST="127.0.0.1"
export KHAI_WORKER_BACKEND="process"
export PORT="8090"

.venv/bin/python -m app_server.gateway
```

Mở [http://127.0.0.1:8090/](http://127.0.0.1:8090/) để xem landing page hoặc [http://127.0.0.1:8090/app](http://127.0.0.1:8090/app) để đăng nhập. `process` chạy worker trong môi trường local; cấu hình triển khai có thể dùng Docker worker riêng.

## Cấu trúc repo

| Thư mục | Nội dung |
| --- | --- |
| `app_server/` | Gateway, API, xác thực và phục vụ giao diện web |
| `core/` | Agent runtime, lưu trữ, công cụ và logic dùng chung |
| `desktop/` | Giao diện React và ứng dụng desktop |
| `docker/stack/` | PostgreSQL, Redis và Qdrant cho môi trường local |
| `app_server/landing/` | Landing page và trang đăng nhập |
| `tests/` | Bộ kiểm tra tự động |

## Giấy phép

Xem [`LICENSE`](LICENSE), [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), cùng các file giấy phép và thông tin nguồn được giữ trong từng thư mục thành phần. Các thông báo bản quyền và giấy phép của dependency cần được giữ khi phân phối.
