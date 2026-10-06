import Link from "next/link";

import { getI18n } from "@/lib/i18n-server";

/** Where a team member lands on a page their role or pages do not cover. */
export default async function NoAccessPage() {
  const { locale } = await getI18n();
  const zh = locale !== "en";
  return (
    <div className="mx-auto max-w-lg p-6 text-center">
      <h1 className="font-serif text-2xl text-[var(--ink)]">{zh ? "没有权限" : "No access"}</h1>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">
        {zh
          ? "你的账号没有打开这个页面的权限。需要的话，请账号的所有者在「账户设置 → 团队成员」里给你开。"
          : "Your account cannot open this page. The account owner can grant it under Account settings → Team."}
      </p>
      <Link href="/dashboard" className="btn-secondary mt-4 inline-flex">
        {zh ? "回到首页" : "Back to dashboard"}
      </Link>
    </div>
  );
}
