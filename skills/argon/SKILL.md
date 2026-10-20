---
name: argon
description: "Tự động kiểm tra/mở cổng 9222 và gửi prompt trực tiếp tới Gemini 4 Argon qua lệnh /argon."
metadata:
  icon: bolt
---

# Lệnh /argon - Cầu nối tự động Gemini 4 Argon

Kỹ năng này được kích hoạt khi người dùng gõ lệnh **`/argon`** hoặc **`/ask-argon`** trong khung chat.

## Quy trình tự động hoá khi nhận lệnh /argon:

### Bước 1: Tự động kiểm tra và mở cổng CDP 9222
Kiểm tra xem trình duyệt đã mở cổng 9222 chưa:
```powershell
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json/version' -UseBasicParsing -TimeoutSec 1;
  Write-Output "CDP_ACTIVE"
} catch {
  Write-Output "CDP_INACTIVE"
}
```
- Nếu `CDP_INACTIVE`:
  Chạy lệnh khởi động trình duyệt tự động ở chế độ background (không chặn tiến trình):
  ```powershell
  Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -ArgumentList "--remote-debugging-port=9222", "--user-data-dir=`"$env:LOCALAPPDATA\Microsoft\Edge\ArgonProfile`"", "https://gemini.google.com/app"
  ```
  (Chờ 2 giây để cổng 9222 sẵn sàng).

### Bước 2: Chuẩn bị Prompt và Ngữ cảnh
- Lấy nội dung yêu cầu mà người dùng đã gõ sau lệnh `/argon`.
- Nếu yêu cầu liên quan đến file hoặc lỗi trong dự án hiện tại, đọc file liên quan để chuẩn bị ngữ cảnh (`--context`).

### Bước 3: Thực thi truy vấn tới Gemini 4 Argon
Chạy lệnh bridge:
```bash
ask-argon.cmd --prompt "<Yêu cầu người dùng>" --context "<Ngữ cảnh nếu có>"
```
(Nếu có file prompt dài: `ask-argon.cmd --file "<path>"`)

### Bước 4: Trình bày kết quả cho người dùng
- Hiển thị phân tích và câu trả lời trực tiếp từ Gemini 4 Argon trong giao diện chat.
- Đưa ra các bước tiếp theo hoặc sửa code nếu người dùng yêu cầu.
