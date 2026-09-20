import EvidenceCore
import PhotosUI
import SwiftUI

/// Answers one question that cannot be reasoned about, only measured: **what
/// does another app actually get when it picks one of our photographs out of
/// the photo library?**
///
/// It matters because claims are filed from the Turo app, and that app reads
/// the library through the same system picker this screen uses. If the
/// location survives here it will survive there; if it does not, then the Turo
/// app cannot carry claim-grade evidence on this phone and the claim has to be
/// filed from a computer instead. Better to find that out in a car park than
/// from a rejection letter.
///
/// Deliberately a tool rather than a paragraph in a document. Phone models,
/// iOS versions and picker behaviour change; an assertion written down today
/// goes stale and nobody notices. Thirty seconds on the actual phone does not.
struct PathCheckView: View {
    @State private var selection: PhotosPickerItem?
    @State private var report: Report?
    @State private var isChecking = false

    struct Report {
        var byteCount: Int
        var captureTime: String?
        var utcOffset: String?
        var latitude: Double?
        var longitude: Double?
        var digest: String
        var provenance: Provenance

        var hasLocation: Bool { latitude != nil && longitude != nil }
        var isOriginal: Bool {
            if case .original = provenance { return true }
            return false
        }
    }

    var body: some View {
        List {
            Section {
                PhotosPicker(selection: $selection, matching: .images, photoLibrary: .shared()) {
                    Label("从相册选一张检查", systemImage: "photo.badge.checkmark")
                }
            } footer: {
                Text("用你平时交给 Turo 的那套操作选照片。这个页面用的是和第三方 App 一样的系统选择器，"
                     + "所以它拿到什么，Turo App 多半也拿到什么。")
            }

            if isChecking {
                Section { ProgressView() }
            }

            if let report {
                Section("这条路安不安全") {
                    Verdict(report: report)
                }
                Section("拿到的是什么") {
                    Row(label: "拍摄时间", value: report.captureTime ?? "缺失", ok: report.captureTime != nil)
                    Row(label: "时区", value: report.utcOffset ?? "缺失", ok: report.utcOffset != nil)
                    Row(label: "位置",
                        value: report.hasLocation
                            ? String(format: "%.6f, %.6f", report.latitude!, report.longitude!)
                            : "缺失",
                        ok: report.hasLocation)
                    switch report.provenance {
                    case .original(let filename, let vehicle):
                        Row(label: "和归档原件", value: "字节完全一致", ok: true)
                        Row(label: "归档文件", value: filename, ok: true)
                        Row(label: "所属批次", value: vehicle, ok: true)
                    case .altered(let filename, let vehicle):
                        Row(label: "和归档原件", value: "对不上，中间被改过", ok: false)
                        Row(label: "应该是", value: "\(vehicle) 的 \(filename)", ok: false)
                    case .unknown:
                        Row(label: "和归档原件", value: "归档里没有这张，无法判断", ok: true)
                    }
                    Row(label: "大小", value: "\(report.byteCount / 1024) KB", ok: true)
                }
            }
        }
        .navigationTitle("路径自检")
        .onChange(of: selection) { _, item in
            guard let item else { return }
            Task { await check(item) }
        }
    }

    private func check(_ item: PhotosPickerItem) async {
        isChecking = true
        defer { isChecking = false }

        guard let data = try? await item.loadTransferable(type: Data.self) else {
            report = nil
            return
        }
        let digest = EvidenceHash.sha256(data)
        let exif = ExifReader(jpeg: data)

        report = Report(
            byteCount: data.count,
            captureTime: exif?.captureTime,
            utcOffset: exif?.utcOffset,
            latitude: exif?.latitude,
            longitude: exif?.longitude,
            digest: digest,
            provenance: ArchiveIndex.provenance(ofDigest: digest, capturedAt: exif?.capturedAt)
        )
    }
}

private struct Verdict: View {
    let report: PathCheckView.Report

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(headline, systemImage: symbol)
                .font(.headline)
                .foregroundStyle(colour)
            Text(detail)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private enum Outcome { case safe, lossy, notOurs }

    /// A photograph we never took says nothing about the delivery path, and
    /// must not be reported as a failure of it.
    private var outcome: Outcome {
        if case .altered = report.provenance { return .lossy }
        if !report.hasLocation || report.captureTime == nil { return .lossy }
        if case .original = report.provenance { return .safe }
        return .notOurs
    }

    private var headline: String {
        switch outcome {
        case .safe: return "这条路可以走"
        case .lossy: return "这条路会丢证据"
        case .notOurs: return "这张不是本 App 拍的"
        }
    }

    private var symbol: String {
        switch outcome {
        case .safe: return "checkmark.seal.fill"
        case .lossy: return "xmark.seal.fill"
        case .notOurs: return "questionmark.circle.fill"
        }
    }

    private var colour: Color {
        switch outcome {
        case .safe: return .green
        case .lossy: return .red
        case .notOurs: return .secondary
        }
    }

    private var detail: String {
        switch outcome {
        case .safe:
            return "选出来的就是相机原件，时间、时区、位置都在。这样交给 Turo 没问题。"
        case .lossy:
            if case .altered = report.provenance {
                return "这张是本 App 拍的，但字节和归档原件对不上，说明中间被重新编码过。"
                     + "元数据还在恰恰是最危险的情况 —— 别用这条路，改成在电脑上用网页提交。"
            }
            if !report.hasLocation {
                return "位置信息没了。Turo 明确把缺位置的照片判为无效 —— "
                     + "检查一下选照片时底部那个「包含位置」的开关是不是被关掉了。"
            }
            return "拍摄时间读不出来，Turo 会以「无法验证拍摄时间」拒收 —— 他们拒过一次了。"
        case .notOurs:
            return "归档里没有这张照片，所以这次检查说明不了这条路安不安全。"
                 + "用本 App 拍的照片再验一次。"
        }
    }
}

private struct Row: View {
    let label: String
    let value: String
    let ok: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
            Spacer()
            Text(value)
                .foregroundStyle(ok ? .secondary : Color.red)
                .multilineTextAlignment(.trailing)
        }
        .font(.callout)
    }
}
