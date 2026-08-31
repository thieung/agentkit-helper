# AgentKit Helper

[English](./README.md)

TUI thân thiện giúp cài đặt và cập nhật AgentKit Kit. Helper tự detect `ak`
binary, hỏi một vài lựa chọn, hiển thị command chính thức rồi chạy giúp bạn.

![Giao diện AgentKit Helper](./assets/tui-preview.svg)

## Bắt đầu

Yêu cầu Node.js 20.12+ và `ak` CLI.

```bash
npx --yes @thieung/agentkit-helper
```

Muốn dùng command ngắn `akh`:

```bash
npm install --global @thieung/agentkit-helper
akh
```

Trong TUI, dùng:

- ↑/↓ để di chuyển
- Space để chọn nhiều runtime
- Enter để xác nhận
- Esc để trở về bước trước

Bạn chỉ cần chọn scope project hoặc user/global, Engineer hoặc Marketing Kit,
một hay nhiều runtime và release channel Stable hoặc Beta. **Sync** scan một lần,
hiện binary `ak` đang cài cùng các Kit đã detect, rồi hỏi confirm trước khi chạy.
Khi thư mục hiện tại là project hợp lệ (không phải `/` hay home), TUI có **Dùng
project hiện tại**; CLI tương đương là `--project .`. AgentKit vẫn quản lý việc
xác minh Kit, ownership, snapshot và file riêng của từng runtime.

Khi cài global scope, helper chạy trước mà không có `--force`. Nếu target đã
tồn tại hoặc có drift, TUI hiển thị WARNING và hỏi consent riêng, mặc định No.
Chỉ khi chọn Yes, helper mới retry bằng `--force`. Global update luôn dùng
preserve-only: file do user chỉnh sửa được bỏ qua và helper không thêm `--force`.

Trạng thái platform: macOS đã được verify local. Linux là target được hỗ trợ
qua code path Node.js portable. Native Windows PowerShell đang ở mức
experimental cho đến khi được smoke-test trên máy thật; repository đã có xử lý
command và CI dành cho Windows nhưng chưa claim provider-backed E2E.

Checklist smoke Windows (thủ công; giữ experimental cho đến khi chạy xong trên
máy thật):

1. Cài `ak` bằng `irm https://agentkit.best/install.ps1 | iex`, rồi mở terminal
   mới.
2. Chạy `npx --yes @thieung/agentkit-helper` (hoặc `akh` sau khi npm install
   global).
3. Trong TUI, chọn **Dùng project hiện tại** (hoặc `akh install --project .`).
4. Cài một runtime, rồi chạy `update-all` cho install đó.

<details>
<summary><strong>Cách dùng CLI nâng cao</strong></summary>

Cài vào project:

```bash
akh install --project /path/to/project --kit engineer \
  --runtime codex --channel stable
```

Cài vào user/global scope của runtime:

```bash
akh install --global --kit engineer \
  --runtime codex,omp,pi --channel stable
```

Cập nhật Kit install hoặc chỉ cập nhật signed `ak` binary:

```bash
akh update --project /path/to/project
akh update-all --channel stable
akh self-update --channel stable
akh sync
```

`akh sync` dùng channel của `ak` binary đang cài. Ở `/` hoặc home thì cập nhật
binary và **mọi runtime đã cài global** mà helper detect được (`claude-code`,
`codex`, `cursor`, `dsh`, `grok`, `omp`, `pi`, kèm profile `pi-ak`/`pi-omp` nếu
có). Ở project do AgentKit sở hữu thì cập nhật thêm Kit của project đó. CLI
one-shot áp dụng ngay; `akh sync --dry-run` chỉ preview.

Preview mà không áp dụng thay đổi:

```bash
akh update --project /path/to/project --dry-run
akh sync --dry-run
```

Các target:

- Cài đặt: `claude-code`, `codex`, `cursor`, `dsh`, `grok`, `omp`, `pi`, `pi-ak`, `pi-omp`
- Cập nhật: `claude-code`, `codex`, `cursor`, `dsh`, `grok`, `omp`, `pi`, `pi-ak`, `pi-omp`
- Export: `agy`, `portable`

Update `dsh` đi qua `ak kit refresh` vì `ak update` remote vẫn reject runtime này. `pi-ak` và `pi-omp` là alias profile chỉ dùng với `--global`; chúng cài/cập nhật vào home Pi/OMP custom, không phải thư mục `pi`/`omp` mặc định.

Chạy `akh --help` để xem toàn bộ command và option.

</details>

## Phát triển local

```bash
npm ci
npm run check
npm test
```

MIT License
