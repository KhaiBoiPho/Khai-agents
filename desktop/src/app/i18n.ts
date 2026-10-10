/**
 * Interface language — machine-local, like appearance (dsh's `locale`).
 *
 * English is the source of truth: every key's English string lives in the
 * component that uses it (as the i18next defaultValue), so untranslated
 * keys render their English text instead of a key name, and the `en`
 * resource table stays empty by construction. Vietnamese (`vi`) is the one
 * translation: the settings dialog, the sidebar, the composer's high-traffic
 * strings and the thread/goal/approval surfaces. Coverage grows per key —
 * never a blocker.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const STORAGE_KEY = "deepcode.desktop.locale.v1";

export const LOCALES = [
  { value: "en", label: "English" },
  { value: "vi", label: "Tiếng Việt" },
] as const;

export type Locale = (typeof LOCALES)[number]["value"];

const VI: Record<string, string> = {
  "provider.signInAuth": "Đăng nhập bằng OpenRouter",
  "provider.account": "Tài khoản",
  "provider.loginExplanation": "Đăng nhập OpenRouter trả về một API key do người dùng quản lý, không có token làm mới. Hãy đăng nhập trên máy đang chạy Khai-Agents.",
  "provider.cancelLogin": "Huỷ đăng nhập",
  "provider.disconnectConfirm": "Ngắt kết nối tài khoản này trên máy này? Các yêu cầu tới model sau đó sẽ dừng. Thu hồi key từ xa trong trang cài đặt của OpenRouter.",
  "provider.disconnect": "Ngắt kết nối tài khoản",
  "provider.manageKeys": "Quản lý key từ xa",
  "provider.openLogin": "Mở trang đăng nhập",
  "provider.login.starting": "Đang bắt đầu đăng nhập",
  "provider.login.pending": "Đang chờ cấp quyền",
  "provider.login.exchanging": "Đang hoàn tất cấp quyền",
  "provider.login.authenticated": "Đã đăng nhập",
  "provider.login.cancelled": "Đã huỷ",
  "provider.login.expired": "Phiên đăng nhập đã hết hạn",
  "provider.login.failed": "Đăng nhập thất bại",
  "provider.protocol": "Giao thức API",
  "provider.auto": "Tự động · giữ định tuyến hiện có",
  "provider.auth": "Xác thực",
  "provider.apiKey": "API key",
  "provider.noAuth": "Không cần xác thực",
  "provider.compat": "Tương thích giao thức",
  "provider.compatExplicit": "Hãy chọn một giao thức API cụ thể trước khi đặt tuỳ chọn tương thích.",
  "provider.inherit": "Kế thừa mặc định",
  "provider.yes": "Có",
  "provider.no": "Không",
  "provider.resetCompat": "Xoá tuỳ chọn tương thích",
  "provider.verifyDraft": "Kiểm tra thiết lập hiện tại",
  "provider.verifyModel": "Model cần kiểm tra",
  "provider.probeBudget": "Dùng thiết lập đang nhập, không lưu cấu hình. Kiểm tra agent gọi model tối đa 3 lần trong 90 giây, chỉ dùng công cụ kiểm tra cục bộ; chế độ suy luận của provider có thể tốn thêm token.",
  "provider.quick": "Kiểm tra nhanh",
  "provider.agentTest": "Kiểm tra tương thích agent",
  "provider.testing": "Đang kiểm tra…",
  "provider.probeStale": "Thiết lập đã thay đổi, hãy kiểm tra lại.",
  "provider.capabilities": "Khả năng của model",
  "provider.inputModalities": "Loại đầu vào",
  "provider.textOnly": "Chỉ văn bản",
  "provider.textImage": "Văn bản và hình ảnh",
  "provider.toolCalling": "Gọi công cụ",
  "provider.compat.tokenLimitField": "Trường giới hạn token",
  "provider.compat.temperature": "Gửi temperature",
  "provider.compat.systemRole": "Vai trò của tin nhắn chỉ dẫn",
  "provider.compat.reasoningField": "Trường tham số suy luận",
  "provider.compat.reasoningContent": "Gửi lại lịch sử suy luận",
  "provider.compat.toolMessageName": "Gửi tên kết quả công cụ",
  "provider.compat.parallelToolCalls": "Gọi công cụ song song",
  "settings.title": "Cài đặt",
  "settings.section.general": "Chung",
  "settings.section.account": "Tài khoản",
  "settings.section.usage": "Mức dùng",
  "settings.section.providers": "Nhà cung cấp",
  "settings.section.mcp": "Kết nối",
  "settings.section.skills": "Kỹ năng",
  "settings.section.plugins": "Plugin",
  "settings.section.agents": "Agent",
  "settings.writeTo": "Ghi vào",
  "settings.scope.user": "Cấu hình người dùng",
  "settings.scope.project": "Dự án hiện tại",
  "settings.openConfig": "Mở file cấu hình",
  "settings.close": "Đóng cài đặt",
  "settings.preset.title": "Preset agent",
  "settings.preset.eyebrow": "Mặc định cho phiên",
  "settings.preset.label": "Phiên mới dùng mặc định",
  "settings.preset.none": "Không · tổ hợp mặc định",
  "settings.preset.save": "Lưu preset mặc định",
  "settings.permissions.title": "Quyền",
  "settings.permissions.eyebrow": "Chính sách an toàn",
  "settings.permissions.label": "Quyền mặc định của phiên",
  "settings.permissions.save": "Lưu thiết lập an toàn",
  "settings.appearance.title": "Giao diện",
  "settings.appearance.eyebrow": "Hiển thị",
  "settings.appearance.light": "Sáng",
  "settings.appearance.dark": "Tối",
  "settings.appearance.system": "Theo hệ thống",
  "settings.appearance.mode": "Chế độ giao diện",
  "settings.appearance.theme": "Chủ đề",
  "settings.appearance.conversationWidth": "Độ rộng hội thoại",
  "settings.appearance.fontSize": "Cỡ chữ",
  "settings.appearance.fontFamily": "Font ưu tiên",
  "settings.appearance.paper": "Paper · tông ấm, ít ánh sáng xanh",
  "settings.appearance.midnight": "Midnight · tông lạnh, tối sâu",
  "settings.appearance.claude": "Claude · trắng ngà và đất nung",
  "settings.appearance.claudeDark": "Claude tối · xám đá và đất nung",
  "settings.appearance.lagoon": "Lagoon · trắng giấy và xanh biển",
  "settings.appearance.lagoonDark": "Lagoon tối · màu đêm và xanh biển",
  "settings.appearance.contrast": "Tương phản cao · AAA",
  "settings.appearance.imported": "Chủ đề đã nhập",
  "settings.appearance.importTheme": "Nhập chủ đề VS Code",
  "settings.appearance.importedReady": "Đã nhập {{name}} · chủ đề nền {{base}}",
  "settings.appearance.importHint": "Đọc một file chủ đề màu JSON/JSONC trên máy; chưa hỗ trợ chuỗi include và màu cú pháp của chủ đề.",
  "settings.appearance.fontPlaceholder": "Ví dụ: Be Vietnam Pro, Inter",
  "settings.appearance.addInstalledFont": "Thêm font đã cài…",
  "settings.appearance.fontGroup.interface": "Font giao diện",
  "settings.appearance.fontGroup.monospace": "Font đơn cách",
  "settings.appearance.fontGroup.cjk": "Font CJK",
  "settings.appearance.fontDescription": "Các font cách nhau bằng dấu phẩy được thử trước font có sẵn. Font chưa cài sẽ được bỏ qua, nên có thể liệt kê nhiều font.",
  "settings.appearance.localOnly": "Các thiết lập hiển thị này chỉ lưu trên máy này, có hiệu lực ngay và không thuộc cấu hình dự án.",
  "settings.appearance.reset": "Khôi phục mặc định",
  "settings.language.title": "Ngôn ngữ",
  "settings.language.eyebrow": "Ngôn ngữ giao diện",
  "settings.language.label": "Ngôn ngữ giao diện",
  "settings.language.note": "Có hiệu lực ngay, chỉ lưu trên máy này. Bản tiếng Anh là bản gốc của mọi nội dung.",
  "settings.composer.title": "Phím Enter khi đang bận",
  "settings.composer.eyebrow": "Ô soạn tin",
  "settings.composer.label": "Khi một lượt đang chạy, Enter sẽ…",
  "settings.composer.steer": "Điều hướng lượt hiện tại",
  "settings.composer.queue": "Xếp hàng cho lượt kế tiếp",
  "settings.composer.note": "Chỉ áp dụng khi đang bận; Cmd/Ctrl+Enter làm hành động còn lại. Khi rảnh, Enter luôn gửi. Có hiệu lực ngay, chỉ lưu trên máy này.",
  "settings.updates.eyebrow": "Kênh phát hành có chữ ký",
  "settings.updates.title": "Cập nhật ứng dụng",
  "settings.updates.check": "Kiểm tra cập nhật",
  "settings.updates.checking": "Đang kiểm tra…",
  "settings.updates.install": "Cài đặt",
  "settings.updates.preparing": "Đang chuẩn bị…",
  "settings.updates.downloading": "Đang tải…",
  "settings.updates.installing": "Đang cài đặt…",
  "settings.updates.upToDate": "Bạn đang dùng bản mới nhất.",
  "settings.updates.available": "Đã có Khai-Agents {{version}}. Chữ ký gói sẽ được kiểm tra trước khi cài.",
  "settings.updates.idle": "Chỉ kiểm tra cập nhật khi bạn yêu cầu. Bản phát triển có thể chưa cấu hình kênh phát hành.",
  "settings.updates.checkingNote": "Đang kiểm tra kênh phát hành có chữ ký.",
  "settings.diagnostics.eyebrow": "Khắc phục sự cố",
  "settings.diagnostics.title": "Chẩn đoán",
  "settings.diagnostics.export": "Xuất báo cáo",
  "settings.diagnostics.exporting": "Đang xuất…",
  "settings.diagnostics.runChecks": "Chạy kiểm tra",
  "settings.diagnostics.savedTo": "Đã lưu báo cáo chẩn đoán (đã ẩn thông tin nhạy cảm) vào {{path}}",
  "settings.diagnostics.noProject": "Chưa chọn dự án",
  "sidebar.threads": "Phiên",
  "sidebar.automations": "Tự động hoá",
  "sidebar.skills": "Kỹ năng",
  "sidebar.plugins": "Plugin",
  "sidebar.mcp": "MCP",
  "sidebar.settings": "Cài đặt",
  "sidebar.projects": "Dự án",
  "sidebar.newThread": "Phiên mới",
  "sidebar.searchSessions": "Tìm phiên",
  "sidebar.openFolder": "Mở thư mục trên máy",
  "sidebar.openFolderHint": "Các phiên từ CLI sẽ hiện ở đây.",
  "sidebar.noResults": "Không có phiên phù hợp",
  "sidebar.noResultsHint": "Có thể tìm theo tiêu đề, dự án hoặc đường dẫn workspace.",
  "sidebar.noSessions": "Chưa có phiên nào",
  "sidebar.showMore": "Xem thêm {{count}}",
  "sidebar.showLess": "Thu gọn",
  "sidebar.previousSessions": "Phiên trước",
  "sidebar.folderUnavailable": "Thư mục gốc không còn",
  "sidebar.localAgent": "Agent cục bộ",
  "sidebar.agentReady": "Agent cục bộ sẵn sàng",
  "sidebar.sharedHistory": "Lịch sử phiên dùng chung",
  "composer.hint.send": "↵ gửi",
  "composer.hint.steerQueue": "↵ điều hướng · ⌘↵ xếp hàng",
  "composer.hint.queueSteer": "↵ xếp hàng · ⌘↵ điều hướng",
  "composer.hint.newline": "⇧↵ xuống dòng",
  "composer.queueNext": "Xếp hàng kế tiếp",
  "composer.dictation.start": "Bắt đầu nhập bằng giọng nói",
  "composer.dictation.stop": "Dừng ghi âm và chuyển thành chữ",
  "composer.dictation.cancel": "Bỏ bản ghi âm",
  "composer.dictation.recording": "Đang ghi âm {{seconds}} giây · dừng để chuyển thành chữ",
  "composer.dictation.transcribing": "Đang chuyển thành chữ…",
  "thread.startThread": "Bắt đầu phiên lập trình cục bộ",
  "thread.folderUnavailable": "Thư mục không khả dụng",
  "thread.noLocalFolder": "Không có thư mục cục bộ",
  "thread.previousSessions": "Phiên trước",
  "thread.trustFolder": "Tin cậy thư mục",
  "thread.trusted": "Đã tin cậy",
  "thread.trustedTooltip": "Cho phép chạy lệnh trong thư mục này",
  "thread.folderUnavailableTooltip": "Thư mục gốc của phiên không còn khả dụng",
  "thread.paper": "Bài báo",
  "thread.paperTooltip": "Tạo phiên Paper2Code",
  "thread.fork": "Tách nhánh",
  "thread.forkTooltip": "Tách sang worktree riêng",
  "thread.review": "Xem lại",
  "thread.closeReview": "Đóng bảng xem lại",
  "thread.openReview": "Mở bảng xem lại",
  "thread.splitterLabel": "Điều chỉnh độ rộng hội thoại",
  "thread.splitterHint": "Kéo để đổi độ rộng hội thoại · nhấp đúp để về mặc định",
  "approval.label": "Cần phê duyệt",
  "approval.decision": "Quyết định: {{status}}",
  "approval.allowContinue": "Cho phép {{tool}} tiếp tục?",
  "approval.reviewOperation": "Hãy xem lại thao tác này trước khi agent tiếp tục.",
  "approval.sensitiveOperation": "Thao tác nhạy cảm",
  "approval.reviewArguments": "Xem tham số",
  "approval.allowOnce": "Cho phép một lần",
  "approval.allowSession": "Cho phép trong phiên này",
  "approval.deny": "Từ chối",
  "runtime.offline": "Máy chủ ứng dụng cục bộ không khả dụng.",
  "runtime.restart": "Khởi động lại dịch vụ",
  "runtime.reconnect": "Kết nối lại",
  "runtime.browserAuthRequired": "Cần cấp quyền truy cập cho trình duyệt",
  "runtime.browserAuthHelp": "Chạy deepcode web trong terminal rồi mở đường dẫn truy cập mới cho trình duyệt. Không cần tài khoản Khai-Agents.",
  "service.title": "Dịch vụ nền",
  "service.stop": "Dừng dịch vụ nền",
  "service.detach": "Đóng Desktop chỉ ngắt cửa sổ này; công việc và lịch hẹn vẫn tiếp tục chạy trong dịch vụ nền dùng chung.",
  "service.activity": "{{phase}} · {{active}} việc đang chạy · {{queued}} việc đang chờ · {{terminals}} terminal",
  "service.stopConfirm": "Dừng dịch vụ nền dùng chung? Đang có {{active}} việc chạy, {{queued}} việc chờ và {{terminals}} terminal. Chờ tối đa 10 giây; nếu vẫn còn việc đang chạy thì dịch vụ được giữ lại.",
  "goal.setGoal": "Đặt mục tiêu",
  "goal.setGoalHint": "Giữ một mục tiêu lâu dài qua các lượt thông thường",
  "goal.sessionGoal": "Mục tiêu của phiên",
  "goal.turn": "Lượt",
  "goal.turns": "Lượt",
  "goal.tokens": "token",
  "goal.continue": "Tiếp tục",
  "goal.editGoal": "Sửa mục tiêu",
  "goal.pause": "Tạm dừng",
  "goal.pauseTooltip": "Tạm dừng tự tiếp tục; không ngắt lượt hiện tại",
  "goal.editReopen": "Sửa và mở lại",
  "goal.resume": "Tiếp tục",
  "goal.edit": "Sửa",
  "goal.newGoal": "Mục tiêu mới",
  "goal.objectiveHint": "Sửa mục tiêu vẫn giữ cùng một Goal và áp dụng cho lượt đang chạy.",
  "goal.outcome": "Kết quả mục tiêu",
  "goal.tokenBudget": "Ngân sách token",
  "goal.tokenBudgetOptional": "Tuỳ chọn",
  "goal.noLimit": "Không giới hạn",
  "goal.skills": "Kỹ năng",
  "goal.cancel": "Huỷ",
  "goal.saveResume": "Lưu và tiếp tục",
  "goal.saveGoal": "Lưu mục tiêu",
  "goal.startGoal": "Bắt đầu mục tiêu",
  "goal.clearGoal": "Xoá mục tiêu",
  "goal.clearConfirm": "Xoá mục tiêu của phiên này?",
  "goal.completionOutcome": "Kết quả hoàn thành",
  "goal.blockedOutcome": "Kết quả bị chặn",
  "goal.relatedActivity": "Hoạt động liên quan",
  "goal.noSkills": "Chưa chọn kỹ năng cho mục tiêu.",
  "goal.activeTime": "{{duration}} thời gian hoạt động",
  "goal.noUsage": "Chưa có mức dùng của lượt Goal đã hoàn thành",
  "goal.tokenBudgetLabel": "Ngân sách {{budget}} token",
  "goal.noTokenBudget": "Không có ngân sách token",
  "goal.decidingTurn": "Lượt quyết định",
  "goal.goalDescription": "Mục tiêu {{id}} gắn với phiên này. Các tin nhắn tiếp theo định hướng công việc mà không ghi đè mục tiêu.",
  "goal.closeEditor": "Đóng trình sửa mục tiêu",
  "goal.describeOutcome": "Mô tả đầy đủ kết quả mà Khai-Agents cần đạt được.",
  "inspector.label": "Bảng kiểm tra",
  "inspector.views": "Chế độ xem kiểm tra",
  "inspector.closeReview": "Đóng bảng xem lại",
  "inspector.tab.changes": "Thay đổi",
  "inspector.tab.files": "File",
  "inspector.tab.artifacts": "Sản phẩm",
  "inspector.tab.tests": "Kiểm thử",
  "inspector.tab.terminal": "Terminal",
  "inspector.tab.history": "Lịch sử",
};

function readLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LOCALES.some((locale) => locale.value === stored)) {
      return stored as Locale;
    }
  } catch {
    // Preferences must never block startup.
  }
  return typeof navigator !== "undefined" &&
    navigator.language?.toLowerCase().startsWith("vi")
    ? "vi"
    : "en";
}

export function setLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // The session still honours the choice.
  }
  void i18n.changeLanguage(locale);
}

export function initI18n(): typeof i18n {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      lng: readLocale(),
      fallbackLng: "en",
      resources: {
        en: { translation: {} },
        vi: { translation: VI },
      },
      interpolation: { escapeValue: false },
      // English lives inline as defaultValue at each call site.
      returnEmptyString: false,
    });
  }
  return i18n;
}

/** Reset for tests: re-init with a known language. */
export function __setLocaleForTests(locale: Locale): void {
  void i18n.changeLanguage(locale);
}
