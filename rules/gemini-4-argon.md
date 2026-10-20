# QUY TẮC KẾT NỐI GEMINI 4 ARGON QUA CDP BRIDGE

Khi người dùng yêu cầu **"dùng Gemini 4 Argon"**, **"hỏi Argon"**, hoặc yêu cầu phân tích suy luận sâu:

1. **Chuẩn bị ngữ cảnh**:
   - Thu thập mã nguồn và log lỗi liên quan.
   - Ghi câu hỏi cùng bối cảnh chi tiết vào prompt.

2. **Khởi chạy Cầu nối (Bridge)**:
   - Kiểm tra kết nối cổng 9222.
   - Gọi công cụ:
     ```bash
     node bin/ask-argon.js --prompt "<Câu hỏi>" --context "<Mã nguồn/Ngữ cảnh>"
     ```
   - Chờ tiến trình thu thập hoàn tất phản hồi từ Gemini 4 Argon.

3. **Tổng hợp kết quả**:
   - Trình bày giải pháp hoặc phân tích nguyên nhân gốc rễ rõ ràng cho người dùng.
   - Tiến hành sửa code nếu người dùng yêu cầu.
