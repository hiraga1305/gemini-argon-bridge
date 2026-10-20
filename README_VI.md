# Gemini Argon Bridge

**Cầu nối CLI và MCP cục bộ ở trạng thái thử nghiệm**, dùng CDP của trình duyệt để hỏi cấu hình Argon đang chọn trong Gemini Web. Bridge gửi prompt và phần ngữ cảnh bạn cung cấp đến tab Gemini Web đã đăng nhập, rồi trả về một lượt trả lời assistant mới đã hoàn tất.

Hiện chỉ hỗ trợ `https://gemini.google.com/`. Trước khi gửi, bridge yêu cầu đúng một tab Gemini Web, nút model đang hiển thị có chữ **Argon** và **Cao/High**, trang không bận và ô nhập trống. Bridge chỉ nhận lượt `model-response` cấp cao nhất mới; nội dung Markdown và model announcer phải có `aria-busy="false"`, phải có `.response-footer.complete.gap`, đồng thời không được còn nút Stop.

Nhãn model đọc từ UI chỉ là bằng chứng quan sát trên trang, không xác thực model backend. Google AI Studio và LM Arena chưa được adapter này hỗ trợ. Gói và các ví dụ tích hợp dưới đây mang tính thử nghiệm; chưa chạy kiểm thử tích hợp trên Claude Code, Cursor, Codex hoặc Antigravity.

## Yêu cầu và cài đặt

- Node.js 20 trở lên.
- Chạy `npm install` trong bản checkout, hoặc `npm install --global "<đường-dẫn-tuyệt-đối-tới-gói-này>"` để có lệnh `ask-argon` và `argon-mcp` ngoài checkout.
- Chrome hoặc Edge được mở với CDP; trong đó có tab Gemini Web và cấu hình Argon phù hợp.

Hãy dùng profile trình duyệt mà bạn chấp nhận để lộ qua CDP. Chương trình nào kết nối được endpoint CDP đều có thể có quyền điều khiển trình duyệt. Khi cần khởi chạy browser mới, script dùng profile riêng `ArgonProfile`; nếu cổng CDP đã mở thì script dùng lại browser hiện có mà không kiểm tra profile. Hãy xác minh profile và tài khoản trước khi gửi nội dung.

Mở Chrome/Edge bằng script đi kèm hoặc tự chạy Chromium với `--remote-debugging-port=9222`. Sau đó liệt kê tab Gemini đủ điều kiện và lấy target ID:

```sh
ask-argon --list-tabs
```

Lệnh này chỉ đọc các tab Gemini Web đang mở. Nếu có nhiều tab, truyền đúng target ID bằng `--tab`.

## Lệnh Slash Command trong Antigravity (`/argon`)

Trong Google Antigravity, bạn có thể gọi bridge trực tiếp từ khung chat mà không cần gõ lệnh terminal thủ công:
- Gõ **`/argon <câu hỏi hoặc nhiệm vụ>`** hoặc **`/ask-argon <nội dung>`** trong ô chat.
- Hệ thống sẽ tự động kiểm tra cổng 9222, tự khởi động Chrome/Edge nếu cổng chưa mở, gửi prompt sang Gemini 4 Argon và in kết quả phân tích suy luận sâu trực tiếp vào cuộc hội thoại.

## CLI

```sh
ask-argon --prompt "Phân tích lỗi này" --context "Ngữ cảnh liên quan đã được phép gửi" --tab "<CDP_TARGET_ID>"
ask-argon --file ./prompt.txt --json
```

CLI cũng nhận prompt dạng đối số vị trí hoặc UTF-8 qua stdin. `--json` chỉ ghi một JSON object vào stdout; tiến độ được ghi vào stderr. Xem toàn bộ tùy chọn bằng `--help`. `ARGON_CDP_ENDPOINT` đặt endpoint CDP; `ARGON_TIMEOUT_SEC` đặt deadline tổng theo giây; cờ CLI được ưu tiên hơn biến môi trường. `--timeout` tính cả thời gian kết nối, chọn tab, chờ khóa, kiểm tra UI, gửi prompt và đợi hoàn tất.

## MCP

Gói cung cấp một tool stdio `ask_gemini_argon`, gồm `prompt`, `context` tùy chọn, `timeoutSeconds` dương tùy chọn (mặc định 600), và `tabId` tùy chọn. Server đọc `ARGON_CDP_ENDPOINT` từ môi trường tiến trình. Server nhận thông báo hủy JSON-RPC; client nên đặt timeout tool lớn hơn deadline bridge.

Sau khi cài gói toàn cục, đặt `argon-mcp` làm command trong cấu hình MCP của host. Các file trong [`adapters/`](adapters/) là ví dụ khởi đầu; hãy chỉnh theo host và tự xác minh host discover/gọi được tool trước khi dựa vào nó. Manifest và cấu hình MCP Antigravity nằm tại [`plugin.json`](plugin.json) và [`mcp_config.json`](mcp_config.json); chưa chạy thử host plugin.

## An toàn và giới hạn

- Chỉ gửi prompt/ngữ cảnh mà bạn có quyền chia sẻ với Google account đang mở trong trình duyệt. Bridge không tự tải file dự án, nhưng phần ngữ cảnh được cung cấp sẽ được gửi đến Gemini Web.
- Khóa CDP theo tab tuần tự hóa các tiến trình của gói này cùng dùng một tab. Khóa không ngăn được thao tác thủ công hoặc phần mềm khác sửa trang.
- Nhãn UI không xác thực backend. Kết quả trả `modelLabelObserved`, `thinkingLabelObserved` và `completionEvidence`; không bao giờ đặt `modelVerified`.
- Thay đổi DOM, trạng thái tài khoản, hạn mức, ngôn ngữ giao diện hoặc lỗi mạng có thể làm bridge dừng an toàn. Trạng thái không hỗ trợ hoặc mơ hồ sẽ bị từ chối.
- Chưa có tuyên bố hỗ trợ mọi hệ điều hành, phiên bản trình duyệt, ngôn ngữ hoặc agent harness.

## Kiểm tra

Xem [phạm vi và kết quả kiểm chứng](docs/VALIDATION.md) hoặc [README tiếng Anh](README.md).

```sh
npm ci
npm test
npm run pack:check
```

Có thể chạy fixture trình duyệt thực tùy chọn bằng Chrome/Edge đã cài, profile tạm, cổng CDP ngẫu nhiên và request interceptor chỉ trả HTML tổng hợp cục bộ:

```sh
npm run test:browser
```

Fixture không gọi Gemini hoặc kết nối website của provider. Kiểm tra live cần được chủ tài khoản cho phép rõ ràng và chỉ nên gửi prompt tổng hợp. Xem [`docs/USAGE.md`](docs/USAGE.md) để biết phạm vi và cấu hình.

## Giấy phép

MIT. Xem [`LICENSE`](LICENSE).
