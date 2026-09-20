import EvidenceCore
import SwiftUI

/// The screen that makes the gates mean something.
///
/// Every check in this app — sharpness, geolocation, standing in the right
/// place — produces a fact, and a fact nobody reads changes nothing. Without
/// somewhere that says "you are not finished yet", a staff member takes
/// twenty-four photographs, three of them without a location, and walks off.
/// The problem then surfaces months later, from an insurer, about a car that
/// has since been rented out nine more times.
///
/// So this is not a receipt. It is the point at which the walk-around either
/// passes or gets sent back.
struct SummaryView: View {
    @Bindable var model: CaptureSessionModel
    @Environment(\.dismiss) private var dismiss

    @Environment(ServerSettings.self) private var settings
    @State private var exporter = PhotoLibraryExporter()
    @State private var uploader: SessionUploader?
    @State private var exportResult: PhotoLibraryExportResult?
    @State private var exportError: String?
    @State private var isExporting = false

    private var readiness: SessionReadiness? {
        model.manifest?.readiness(in: model.plan)
    }

    var body: some View {
        List {
            if let readiness {
                Section {
                    if readiness.canFinish {
                        Label("\(model.plan.count) 张都拍齐了", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    } else {
                        ForEach(readiness.blockers, id: \.self) { blocker in
                            BlockerRow(blocker: blocker)
                        }
                    }
                } header: {
                    Text(model.manifest?.vehicleLabel ?? "")
                }

                if !readiness.warnings.isEmpty {
                    Section("交单前要知道的事") {
                        ForEach(readiness.warnings, id: \.self) { warning in
                            WarningRow(warning: warning)
                        }
                    }
                }
            }

            Section {
                Button {
                    Task { await exportToLibrary() }
                } label: {
                    HStack {
                        Label("存进相册，交给 Turo App", systemImage: "square.and.arrow.down")
                        if isExporting { Spacer(); ProgressView() }
                    }
                }
                .disabled(isExporting || readiness?.canFinish != true)
            } footer: {
                Text("会建一个以车牌命名的相簿，Turo App 里一眼能找到。"
                     + "存完会把每张读回来核对，确认系统没有在中间重新编码。")
            }

            if let exportResult {
                Section("存进相册的结果") {
                    ExportVerdict(result: exportResult)
                }
            }

            Section {
                Button {
                    Task { await uploadToServer() }
                } label: {
                    HStack {
                        Label("传一份到后台", systemImage: "externaldrive.badge.icloud")
                        Spacer()
                        UploadState(state: uploader?.state ?? .idle)
                    }
                }
                .disabled(isUploading || readiness?.canFinish != true)
                if case .finished(let summary) = uploader?.state {
                    UploadVerdict(summary: summary)
                }
                if case .failed(let message) = uploader?.state {
                    Text(message).foregroundStyle(.red).font(.footnote)
                }
            } footer: {
                Text("相册那份是交给 Turo 用的，这一份是留底的。"
                     + "后台会自己重算哈希、重读元数据，对不上会当场拒收。")
            }
            if let exportError {
                Section {
                    Text(exportError).foregroundStyle(.red).font(.footnote)
                }
            }

            Section {
                ForEach(model.plan) { slot in
                    SlotStatusRow(slot: slot, record: model.manifest?.acceptedRecord(forSlot: slot.id))
                }
            } header: {
                Text("逐张")
            }
        }
        .navigationTitle("交单前检查")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var isUploading: Bool {
        if case .working = uploader?.state { return true }
        return false
    }

    private func uploadToServer() async {
        guard let archive = model.archive, let manifest = model.manifest else { return }
        let uploader = uploader ?? SessionUploader(settings: settings)
        self.uploader = uploader
        await uploader.upload(archive: archive, manifest: manifest, plan: model.plan)
    }

    private func exportToLibrary() async {
        guard let archive = model.archive, let manifest = model.manifest else { return }
        isExporting = true
        exportError = nil
        defer { isExporting = false }

        do {
            exportResult = try await exporter.export(from: archive, manifest: manifest)
        } catch {
            exportError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}

private struct BlockerRow: View {
    let blocker: SessionBlocker

    var body: some View {
        switch blocker {
        case .shotsOutstanding(let count):
            Label("还差 \(count) 张没拍，拍完才能交", systemImage: "exclamationmark.circle.fill")
                .foregroundStyle(.red)
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
        case .takenOffStation(let count): return "\(count) 张不是在指定位置拍的"
        case .qualityOverridden(let count): return "\(count) 张是手动放行的"
        }
    }

    private var advice: String {
        switch warning {
        case .missingLocation:
            return "Turo 会把缺位置的照片判为无效。如果车停在地下车库，开到室外把这几张补拍一遍。"
        case .takenOffStation:
            return "这几张的拍摄位置和计划对不上，可能是同一个角度拍了两次。有争议时说服力会打折。"
        case .qualityOverridden:
            return "清晰度没过但被放行了。谁放的行记在案里，有条件的话重拍。"
        }
    }
}

private struct ExportVerdict: View {
    let result: PhotoLibraryExportResult

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(result.isLossless ? "相簿「\(result.albumTitle)」已建好" : "相册改动了照片",
                  systemImage: result.isLossless ? "checkmark.seal.fill" : "xmark.seal.fill")
                .foregroundStyle(result.isLossless ? .green : .red)
                .font(.callout.weight(.medium))

            if result.isLossless {
                Text("\(result.intact.count) 张读回来字节完全一致 —— 相册这一步没有动过文件。"
                     + "去 Turo App 里从这个相簿选图。")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                // The silent failure this whole app is built to catch, caught.
                Text("有 \(result.altered.count + result.unverified.count) 张读回来和原件对不上，"
                     + "说明这台手机的相册会重新编码。**别用这条路交单** —— "
                     + "改成在电脑上从后台下载原件，用 Turo 网页提交。")
                    .font(.caption).foregroundStyle(.red)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct SlotStatusRow: View {
    let slot: ShotSlot
    let record: CaptureRecord?

    var body: some View {
        HStack {
            Image(systemName: symbol).foregroundStyle(colour)
            Text(slot.titleZH)
            Spacer()
            if let record, record.attempt > 1 {
                Text("第 \(record.attempt) 次").font(.caption).foregroundStyle(.secondary)
            }
        }
        .font(.callout)
    }

    private var symbol: String {
        guard let record else { return "circle.dashed" }
        if !record.evidence.isClaimReady || record.stationVerified == false || !record.acceptedDespite.isEmpty {
            return "exclamationmark.circle.fill"
        }
        return "checkmark.circle.fill"
    }

    private var colour: Color {
        guard let record else { return .secondary }
        if !record.evidence.isClaimReady || record.stationVerified == false || !record.acceptedDespite.isEmpty {
            return .orange
        }
        return .green
    }
}

private struct UploadState: View {
    let state: SessionUploader.State

    var body: some View {
        switch state {
        case .idle:
            EmptyView()
        case .working(let done, let total):
            Text("\(done) / \(total)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        case .finished:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .failed:
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
        }
    }
}

/// The server's own verdict, which is not the same as ours.
///
/// It re-read every file's metadata from the bytes it received. Where it
/// disagrees with what the phone reported, the server is the one to believe —
/// it is the copy an insurer would eventually be shown.
private struct UploadVerdict: View {
    let summary: SessionUploader.CompletionSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("\(summary.uploaded) 张已经传上去了", systemImage: "checkmark.seal.fill")
                .font(.callout.weight(.medium))
                .foregroundStyle(.green)
            if !summary.isClean {
                Text("后台复核后标出来的：").font(.caption).foregroundStyle(.secondary)
                ForEach(notes, id: \.self) { note in
                    Text("· " + note).font(.caption).foregroundStyle(.orange)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var notes: [String] {
        var notes: [String] = []
        if !summary.missingLocation.isEmpty { notes.append("\(summary.missingLocation.count) 张缺元数据") }
        if !summary.takenOffStation.isEmpty { notes.append("\(summary.takenOffStation.count) 张不在指定位置") }
        if !summary.qualityOverridden.isEmpty { notes.append("\(summary.qualityOverridden.count) 张手动放行") }
        // Only the server can notice this: it compares the phone's clock with
        // its own, and a phone clock is something a person can change.
        if !summary.suspectClock.isEmpty { notes.append("\(summary.suspectClock.count) 张拍摄时手机时间不对") }
        return notes
    }
}
