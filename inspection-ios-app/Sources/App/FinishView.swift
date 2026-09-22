import EvidenceCore
import SwiftUI

/// The only form in the app, and it comes after the work.
///
/// Two questions, both usually answered already: which car (read off the
/// plate in the photographs) and which end of the trip. Asking them at the
/// start would have put a form between somebody and a camera; asking them
/// here costs a glance and a tap, and the app has had a whole walk-around to
/// work out the answers itself.
struct FinishView: View {
    @Bindable var model: CaptureSessionModel
    @Environment(ServerSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss

    @State private var plate = ""
    @State private var photographer = ""
    @State private var kind: SessionKind = .checkin
    @State private var exportResult: PhotoLibraryExportResult?
    @State private var uploader: SessionUploader?
    @State private var busy = false
    @State private var problem: String?

    private var readiness: SessionReadiness? { model.manifest?.readiness() }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Text("车牌")
                        Spacer()
                        TextField("", text: $plate)
                            .multilineTextAlignment(.trailing)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .font(.body.monospaced())
                    }
                    HStack {
                        Text("拍照人")
                        Spacer()
                        TextField("", text: $photographer).multilineTextAlignment(.trailing)
                    }
                    Picker("", selection: $kind) {
                        Text("交车").tag(SessionKind.checkout)
                        Text("还车").tag(SessionKind.checkin)
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    if model.suggestedPlate != nil {
                        Text("车牌是从照片里认出来的，不对就改。")
                    } else {
                        Text("照片里没认出车牌，填一下。")
                    }
                }

                Section("这一单") {
                    LabelledRow("照片", "\(model.progress.totalShots) 张")
                    LabelledRow("外观 / 车内", "\(model.progress.exteriorShots) / \(model.progress.interiorShots)")
                    if model.coverage.canMeasure {
                        LabelledRow("覆盖", "\(Int(model.progress.coverage * 100))%")
                    }
                    // ⚠️ The mirror's own counter, not the manifest's. The
                    // manifest lags by however many saves are still in
                    // flight, and a number that reads low is a number
                    // somebody acts on.
                    LabelledRow("已存进相册", "\(model.library.saved) 张")
                }

                if let warnings = readiness?.warnings, !warnings.isEmpty {
                    Section("交单前要知道的事") {
                        ForEach(warnings, id: \.self) { WarningRow(warning: $0) }
                    }
                }

                Section {
                    Button {
                        Task { await saveToLibrary() }
                    } label: {
                        row("按车牌命名相簿，核对每一张", systemImage: "checkmark.seal")
                    }
                    .disabled(busy || plate.isEmpty)

                    Button {
                        Task { await upload() }
                    } label: {
                        row("传一份到后台", systemImage: "externaldrive.badge.icloud")
                    }
                    .disabled(busy || plate.isEmpty)
                } footer: {
                    Text("照片是**边拍边存**进相册的，这里不用再存一次。"
                         + "这颗按钮做三件事：把漏掉的补上、把相簿改成车牌的名字、"
                         + "把每一张从相册读回来和原件逐字节核对。"
                         + "相册那份是交给 Turo 用的，后台那份是留底的。")
                }

                if let exportResult { Section("存进相册的结果") { ExportVerdict(result: exportResult) } }
                if case .finished(let summary) = uploader?.state {
                    Section("后台复核") { UploadVerdict(summary: summary) }
                }
                if let problem {
                    Section { Text(problem).font(.footnote).foregroundStyle(.red) }
                }
            }
            .navigationTitle("交单")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("继续拍") { dismiss() }
                }
            }
            .task {
                plate = model.suggestedPlate ?? ""
                photographer = settings.photographer
                await model.describe(vehicleLabel: plate, staffLabel: photographer, kind: kind)
            }
        }
    }

    private func row(_ title: String, systemImage: String) -> some View {
        HStack {
            Label(title, systemImage: systemImage)
            if busy { Spacer(); ProgressView() }
        }
    }

    private func commitDescription() async {
        settings.photographer = photographer
        await model.describe(
            vehicleLabel: plate.trimmingCharacters(in: .whitespaces).uppercased(),
            staffLabel: photographer,
            kind: kind
        )
    }

    private func saveToLibrary() async {
        guard let archive = model.archive else { return }
        busy = true; problem = nil
        defer { busy = false }
        await commitDescription()
        guard let manifest = model.manifest else { return }
        do {
            exportResult = try await model.library.finish(archive: archive, manifest: manifest)
            self.model.refreshManifest(await archive.manifest)
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func upload() async {
        guard let archive = model.archive else { return }
        busy = true; problem = nil
        defer { busy = false }
        await commitDescription()
        guard let manifest = model.manifest else { return }
        let uploader = uploader ?? SessionUploader(settings: settings)
        self.uploader = uploader
        await uploader.upload(archive: archive, manifest: manifest)
        if case .failed(let message) = uploader.state { problem = message }
    }
}

private struct LabelledRow: View {
    let title: String
    let value: String
    init(_ title: String, _ value: String) { self.title = title; self.value = value }

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            Text(value).foregroundStyle(.secondary).monospacedDigit()
        }
    }
}

private struct WarningRow: View {
    let warning: SessionWarning

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(headline, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .font(.callout.weight(.medium))
            Text(advice).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }

    private var headline: String {
        switch warning {
        case .missingLocation(let count): return "\(count) 张没有位置信息"
        case .qualityOverridden(let count): return "\(count) 张是手动放行的"
        case .partialCoverage(let fraction, _): return "车身覆盖 \(Int(fraction * 100))%"
        }
    }

    private var advice: String {
        switch warning {
        case .missingLocation:
            return "Turo 会把缺位置的照片判为无效。车停在地下车库的话，开到室外把这几张补拍一遍。"
        case .qualityOverridden:
            return "清晰度没过但被放行了。谁放的行记在案里，有条件的话重拍。"
        case .partialCoverage(_, let thinnest):
            let where_ = thinnest.map { "，\($0.titleZH)最少" } ?? ""
            return "还有一部分车身没拍到\(where_)。多拍几张，理赔时说服力更强。"
        }
    }
}

private struct ExportVerdict: View {
    let result: PhotoLibraryExportResult

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(result.isLossless ? "相簿「\(result.albumTitle)」核对通过" : "相册改动了照片",
                  systemImage: result.isLossless ? "checkmark.seal.fill" : "xmark.seal.fill")
                .foregroundStyle(result.isLossless ? .green : .red)
                .font(.callout.weight(.medium))
            Text(result.isLossless
                 ? "\(result.intact.count) 张读回来字节完全一致 —— 相册这一步没有动过文件。去 Turo App 里从这个相簿选图。"
                 : "有 \(result.altered.count + result.unverified.count) 张读回来和原件对不上，说明这台手机的相册会重新编码。别用这条路交单 —— 改成在电脑上从后台下载原件，用 Turo 网页提交。")
                .font(.caption)
                .foregroundStyle(result.isLossless ? Color.secondary : Color.red)
        }
        .padding(.vertical, 4)
    }
}

/// The server's own verdict, which is not the same as ours: it re-read every
/// file's metadata from the bytes it received.
private struct UploadVerdict: View {
    let summary: SessionUploader.CompletionSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("\(summary.uploaded) 张已经传上去了", systemImage: "checkmark.seal.fill")
                .font(.callout.weight(.medium))
                .foregroundStyle(.green)
            ForEach(notes, id: \.self) { note in
                Text("· " + note).font(.caption).foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 4)
    }

    private var notes: [String] {
        var notes: [String] = []
        if !summary.missingLocation.isEmpty { notes.append("\(summary.missingLocation.count) 张缺元数据") }
        if !summary.qualityOverridden.isEmpty { notes.append("\(summary.qualityOverridden.count) 张手动放行") }
        // Only the server can notice this: it compares the phone's clock with
        // its own, and a phone clock is something a person can change.
        if !summary.suspectClock.isEmpty { notes.append("\(summary.suspectClock.count) 张拍摄时手机时间不对") }
        return notes
    }
}
