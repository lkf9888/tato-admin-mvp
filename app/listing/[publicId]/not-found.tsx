import { getI18n } from "@/lib/i18n-server";

export default async function ListingNotFound() {
  const { locale } = await getI18n();
  const copy =
    locale === "zh"
      ? {
          title: "该房源暂时不可查看",
          description: "这个页面可能还没有发布、已经下线，或者分享链接已经失效。",
        }
      : {
          title: "This listing is not available right now",
          description: "The page may be unpublished, removed, or the shared link is no longer active.",
        };

  return (
    <main className="min-h-screen bg-[#f3efe6] px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-2xl rounded-[2rem] border border-white/70 bg-white px-6 py-8 shadow-[0_26px_70px_-48px_rgba(15,23,42,0.45)]">
        <p className="text-[11px] uppercase tracking-[0.34em] text-slate-500">Harborline Living</p>
        <h1 className="mt-4 font-serif text-4xl text-slate-950">{copy.title}</h1>
        <p className="mt-4 max-w-xl text-sm leading-7 text-slate-600">{copy.description}</p>
      </div>
    </main>
  );
}
