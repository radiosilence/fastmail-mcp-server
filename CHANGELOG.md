# Changelog

All notable changes to this project will be documented in this file.

## [0.5.1] - 2026-01-11

### Fixed

- Detect images by file extension, not just MIME type (JMAP blob downloads return `application/octet-stream`)
- Infer correct MIME type from extension for image attachments

## [0.5.0] - 2026-01-11

### Added

- **Automatic image resizing** - images over 1MB are resized/compressed to fit within Claude's model limits
  - Uses sharp for high-quality resizing (max 2048px)
  - Progressive JPEG quality reduction if still too large
  - Shows original and resized sizes in output (e.g. `1600KB → 850KB resized`)

### Fixed

- Added `bin` entry to package.json for global npm install support

## [0.4.0] - 2026-01-11

### Added

- **Masked email support** - create, list, enable, disable, delete disposable email addresses
  - `list_masked_emails` - view all masked addresses with status
  - `create_masked_email` - create new masked address with optional domain/description/prefix
  - `enable_masked_email` / `disable_masked_email` / `delete_masked_email` - manage lifecycle
- **Advanced search filters** - precise email filtering beyond simple text search
  - `from`, `to`, `cc`, `subject`, `body` - field-specific search
  - `before`, `after` - date range filtering (YYYY-MM-DD or ISO 8601)
  - `unread`, `flagged` - status filters
  - `has_attachment` - attachment filter
  - `mailbox` - limit search to specific folder
- **Forward email** - forward emails with preview→confirm safety flow
- **Thread context** - `get_email` now automatically returns full conversation thread

### Changed

- Search tool now accepts structured filters in addition to simple query string
- Bumped MCP server version to 0.4.0

## [0.3.0] - 2026-01-11

### Added

- Thread support via JMAP Thread/get
- `get_email` returns all emails in thread, sorted chronologically

### Fixed

- Search now uses OR filter across subject/from/to/body (Fastmail doesn't support generic `text` filter)

## [0.2.2] - 2026-01-11

### Fixed

- Comparison table accuracy - @jahfer has search, willmeyers has send+CC/BCC

## [0.2.1] - 2026-01-11

### Changed

- README improvements and feature comparison table

## [0.2.0] - 2026-01-11

### Added

- **Attachment text extraction** - readable text from documents instead of binary blobs
  - PDF, DOCX, XLSX, PPTX, RTF, ODT via [officeparser](https://github.com/harshankur/officeParser)
  - Legacy .doc files via macOS `textutil` (fallback for OLE format)
  - Images returned as `type: "image"` for Claude's native OCR
- Attachment resources (MCP resource protocol)
- Usage prompt (`fastmail-usage`) for Claude to understand tool capabilities
- Feature comparison table in README

### Fixed

- Email send body format - removed `size` and `charset` from textBody (JMAP spec compliance)

## [0.1.0] - 2026-01-10

### Added

- Initial release
- **Read operations**
  - `list_mailboxes` - list all folders with unread counts
  - `list_emails` - list emails in a mailbox with summaries
  - `get_email` - get full email content by ID
  - `search_emails` - search across all mailboxes
  - `list_attachments` - list attachments on an email
  - `get_attachment` - download attachment content
- **Write operations**
  - `send_email` - compose and send new emails
  - `reply_to_email` - reply to existing threads with proper headers
  - `move_email` - move emails between folders
  - `mark_as_read` - toggle read/unread status
  - `mark_as_spam` - move to Junk and train spam filter
- **Safety features**
  - Preview→confirm flow for all email sending operations
  - No emails sent without explicit two-step confirmation
- CC/BCC support on send and reply
- Custom JMAP client (no external JMAP dependencies)
- Bun runtime support
- Claude Desktop integration via MCP
