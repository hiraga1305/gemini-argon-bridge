# QUY TẮC KẾT NỐI GEMINI 4 ARGON QUA CDP BRIDGE

Khi người dùng yêu cầu **"dùng Gemini 4 Argon"**, **"hỏi Argon"**, gõ lệnh **`/argon`** / **`/ask-argon`**, hoặc yêu cầu tham vấn mô hình Argon trên Gemini Web:

1. **Chuẩn bị ngữ cảnh**:
   - Thu thập mã nguồn và lỗi liên quan được phép chia sẻ.
   - Tránh đưa các thông tin bí mật (API keys, secrets) vào prompt.

2. **Khởi chạy Cầu nối (Bridge)**:
   - Đảm bảo trình duyệt Edge/Chrome đã bật cổng 9222 (tự động bật nếu chưa mở) và đang mở tab `https://gemini.google.com/` với mô hình Argon (chế độ Cao/High).
   - Gọi công cụ:
     ```bash
     ask-argon.cmd --prompt "<Câu hỏi>" --context "<Mã nguồn/Ngữ cảnh>"
     ```
   - (Hoặc dùng `ask-argon` trên Linux/macOS, hoặc gọi MCP tool `ask_gemini_argon`).

3. **Tổng hợp kết quả**:
   - Trình bày giải pháp hoặc phân tích nguyên nhân gốc rễ rõ ràng cho người dùng.
   - Tiến hành cập nhật/sửa code nếu người dùng yêu cầu.
