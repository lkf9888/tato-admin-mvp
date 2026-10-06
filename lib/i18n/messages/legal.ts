/**
 * The legal pages: a rental site's privacy policy and booking terms
 * (the operator is the business the renter deals with), and TATO's own
 * privacy policy and terms for operators.
 *
 * Drafts, not reviewed by a lawyer. Every fact about what is collected
 * and who receives it is read off the code (lib/legal.ts lists the
 * services); keep it that way when a feature changes what it collects,
 * because a privacy page that describes an imagined product is worse
 * than none.
 *
 * English governs; the Chinese is a translation, and each page says so.
 */

/** The facts are typed inline below: scripts/generate-zh-hant.ts copies
 *  only the `zh` block, so a named type would not survive into it. */
export type LegalSection = { heading: string; body: readonly string[] };
export type LegalDocument = { title: string; intro: string; sections: readonly LegalSection[] };

export type RenterLegalFacts = {
  brand: string;
  /** "email, phone" as the site lists them, or null when it lists none. */
  contact: string | null;
  address: string | null;
  /** The cancellation policy in one sentence. */
  cancellation: string;
  /** The site has Google Analytics or Ads tags configured. */
  analytics: boolean;
};

export type PlatformLegalFacts = {
  entity: string;
  address: string;
  email: string;
  jurisdiction: string;
};

export const legalMessages = {
  en: {
    legal: {
      privacyLink: "Privacy",
      termsLink: "Terms",
      effective: (date: string) => `Effective ${date}`,
      draftBanner:
        "Draft — not yet published. Some details are missing, and this text has not been reviewed by a lawyer.",
      governingNote: "If a translation differs from the English text, the English text applies.",
      backHome: "Back to home",
      bookingConsent: (brand: string) =>
        `By booking you agree to ${brand}'s booking terms and privacy policy.`,

      renterPrivacy: (f: { brand: string; contact: string | null; address: string | null; cancellation: string; analytics: boolean }) => ({
        title: "Privacy policy",
        intro: `${f.brand} ("we") rents cars through this website. This policy explains what we collect when you browse and book, why we need it, who else handles it, and what you can ask of us.`,
        sections: [
          {
            heading: "What we collect",
            body: [
              "Booking details: your name, email address, phone number, the car, pick-up and return times and places, and any extras you choose.",
              "Your driver's licence: the photos you upload at checkout, and whether your licence is local (British Columbia). We use them to confirm you may drive the car and to apply the right insurance rate.",
              "Your signature on the rental agreement, with the time it was signed and the IP address and browser it was signed from, as a record of the agreement.",
              "Payment: card payments are handled by Stripe. We never see or store your full card number. We keep a reference to each payment, and when you agree at checkout, Stripe keeps your card on file so that charges the rental agreement allows after the trip (extra days, excess kilometres, damage) can be made.",
              "Check-in photos and odometer readings at pick-up and return, including the time and place a photo was taken when your camera records them.",
              "What you send us: change and cancellation requests and other messages about your booking.",
              ...(f.analytics
                ? [
                    "Website use: this site uses Google Analytics and/or Google Ads tags, which use cookies to record the pages visited and whether a booking was completed. You can block these cookies in your browser.",
                  ]
                : []),
            ],
          },
          {
            heading: "Why we use it",
            body: [
              "To take and manage your booking and carry out the rental agreement; to confirm you are eligible to drive and insured; to take payment and hold and return the deposit; to keep evidence of the car's condition and of what was agreed in case of damage or a dispute; to contact you about your booking (confirmations, reminders, changes); and to meet our legal, tax and insurance obligations.",
              "We do not sell your information, and we do not send you marketing unless you ask for it.",
            ],
          },
          {
            heading: "Who else handles it",
            body: [
              "Stripe, which processes payments and stores saved cards.",
              "The booking software provider that runs this website and stores booking records on our behalf, and the hosting and email delivery services it uses. They may process your information only to provide that service to us.",
              "Our insurer (such as ICBC), the police or other authorities, and toll or parking agencies, when a claim, an offence or the law requires it.",
              "Your information may be stored and processed outside your province or country, including in the United States.",
            ],
          },
          {
            heading: "How long we keep it",
            body: [
              "Licence photos and signatures from checkouts that were never paid are deleted after 7 days.",
              "For completed bookings, we keep booking records, the signed agreement, payment records and check-in photos for as long as needed to complete the rental, resolve claims and meet tax and legal record-keeping requirements (generally up to 7 years), then delete them.",
            ],
          },
          {
            heading: "Your choices",
            body: [
              "You can ask to see the information we hold about you, to correct it, or to delete it where we are not required to keep it. Contact us using the details below.",
              "If you are not satisfied with our answer, you can complain to the Office of the Information and Privacy Commissioner for British Columbia.",
            ],
          },
          {
            heading: "Security",
            body: [
              "The site uses encrypted connections (HTTPS), access to booking records is limited to people who need it, and card details stay with Stripe.",
            ],
          },
          {
            heading: "Changes and contact",
            body: [
              "We may update this policy; the date at the top shows when it last changed.",
              `Questions or requests: ${[f.brand, f.contact, f.address].filter(Boolean).join(" · ")}.`,
            ],
          },
        ],
      }),

      renterTerms: (f: { brand: string; contact: string | null; address: string | null; cancellation: string; analytics: boolean }) => ({
        title: "Booking terms",
        intro: `These terms apply when you book a car from ${f.brand} ("we") through this website. The rental itself is governed by the rental agreement you sign when you book.`,
        sections: [
          {
            heading: "Booking and payment",
            body: [
              "The price shown before you pay includes the rent, insurance, any extras and fees, and taxes. It is charged in full when you book, through Stripe.",
              "A security deposit, if shown, is charged at booking and returned after the trip, less anything owed under the rental agreement.",
              "A booking is confirmed once payment succeeds and you receive our confirmation email.",
            ],
          },
          {
            heading: "The rental agreement",
            body: [
              "You sign the rental agreement on the booking page. It sets the rules of the rental: who may drive, how the car may be used, the daily kilometre allowance, fuel, damage, insurance and deposit. Where these terms and the agreement differ, the agreement applies to the rental.",
            ],
          },
          {
            heading: "Drivers",
            body: [
              "Every driver must hold a valid driver's licence. If we cannot confirm a licence, we may cancel the booking and refund it in full.",
            ],
          },
          {
            heading: "Changes and cancellations",
            body: [
              "Use the link in your confirmation email to ask for different dates or to cancel. We confirm every change.",
              `Cancellation policy: ${f.cancellation} The deposit is always returned in full.`,
              "New dates are priced at current rates. If they cost more, the difference is charged; if they cost less, the difference is refunded when the request is made before the free-cancellation deadline.",
              "If we cannot provide the car for reasons on our side, we will offer an alternative or refund you in full.",
            ],
          },
          {
            heading: "Charges after the trip",
            body: [
              "Extra days, kilometres over the allowance, fuel, tolls, tickets and damage are charged as the rental agreement sets out, to the card saved at booking or through a payment link we send you.",
            ],
          },
          {
            heading: "Check-in photos",
            body: [
              "Please photograph the car at pick-up and at return through your booking page. These photos, and ours, are used as the record of the car's condition.",
            ],
          },
          {
            heading: "This website",
            body: [
              "We keep prices, availability and descriptions as accurate as we can. Photos show the model and may differ in detail from the car you receive. A price is fixed once your booking is paid.",
              "Nothing in these terms limits any right you have that cannot be limited by law.",
            ],
          },
          {
            heading: "Law and contact",
            body: [
              "These terms are governed by the laws of British Columbia and the federal laws of Canada that apply there.",
              `Questions: ${[f.brand, f.contact, f.address].filter(Boolean).join(" · ")}.`,
            ],
          },
        ],
      }),

      platformPrivacy: (f: { entity: string; address: string; email: string; jurisdiction: string }) => ({
        title: "TATO privacy policy",
        intro: `${f.entity} ("we") provides TATO, software that car-rental operators use to run their fleet, import their Turo trips, and take bookings on their own website. This policy covers the information we handle in providing it.`,
        sections: [
          {
            heading: "Two roles",
            body: [
              "For your own account we decide how your information is used, as this policy describes.",
              "Information you put into TATO about other people — renters, Turo guests, car owners, staff — we process on your behalf and on your instructions, to provide the service to you. You are responsible for having the right to collect it and for telling those people how it is used. TATO gives every rental website a privacy policy and booking terms you can review and adapt.",
            ],
          },
          {
            heading: "What we collect",
            body: [
              "Account: your name, email address and a hashed password, your workspace and the people you invite.",
              "Fleet and bookings: vehicles, owners, orders, calendars, prices, photos, documents and contracts you create or upload; Turo trips you import by CSV or from booking emails; guest messages; staff schedules.",
              "Bookings on your website: what the renter enters at checkout (see the site's privacy policy), check-in photos, signed agreements.",
              "Payments: your Stripe account identifier and payout status. Card details are entered on Stripe's own forms and never reach our servers.",
              "Records of activity in your workspace, and the technical information needed to run and secure the service (for example sign-in times and IP addresses).",
            ],
          },
          {
            heading: "Email access",
            body: [
              "If you connect a mailbox, TATO reads only messages from Turo — booking, change and cancellation notices and guest messages — to import your trips and messages. It does not send email from your mailbox, and does not read other messages.",
              "TATO's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements. Information from your mailbox is not used for advertising, is not sold, and is not used to train AI models.",
            ],
          },
          {
            heading: "Service providers",
            body: [
              "Railway (application hosting, database and file storage, in the United States); Stripe (payments and payouts); Resend or your own SMTP provider (email delivery); Moonshot AI (the assistant, message translation and reading booking emails — only the text a feature needs is sent); Twilio (text messages, if enabled); Tencent WeChat (staff notifications, if enabled); Google (your mailbox, if connected).",
              "Each may process information only to provide its service.",
            ],
          },
          {
            heading: "How long we keep it",
            body: [
              "While your account is active. Deleted orders stay in the trash until you empty it. When you close your account we delete your workspace within 30 days, except what the law requires us to keep and backups, which expire on their own schedule.",
            ],
          },
          {
            heading: "Your rights",
            body: [
              `You can ask for a copy of your information, its correction or its deletion by writing to ${f.email}. You can also complain to the Office of the Information and Privacy Commissioner for British Columbia.`,
            ],
          },
          {
            heading: "Security",
            body: [
              "Connections are encrypted, passwords are stored hashed, every workspace's data is kept separate, and access is limited to the people who run the service.",
            ],
          },
          {
            heading: "Changes and contact",
            body: [
              "We may update this policy; the date at the top shows when it last changed, and we will tell account holders about significant changes.",
              `${f.entity} · ${f.address} · ${f.email}`,
            ],
          },
        ],
      }),

      platformTerms: (f: { entity: string; address: string; email: string; jurisdiction: string }) => ({
        title: "TATO terms of service",
        intro: `These terms are an agreement between you and ${f.entity} ("we") for the use of TATO. By creating an account or using TATO you accept them.`,
        sections: [
          {
            heading: "The service",
            body: [
              "TATO helps car-rental operators manage vehicles, owners, calendars and orders, import Turo trips, publish a booking website, take payments through Stripe, and sign rental agreements. Features may change over time.",
            ],
          },
          {
            heading: "Your account",
            body: [
              "Keep your sign-in details secure. You are responsible for what happens in your workspace, including what the people you invite do.",
            ],
          },
          {
            heading: "Your data",
            body: [
              "Your data remains yours. You allow us to store and process it only to provide TATO to you. You are responsible for collecting renters', guests', owners' and staff members' information lawfully and for the notices you give them.",
            ],
          },
          {
            heading: "Turo",
            body: [
              "TATO is not affiliated with or endorsed by Turo. Importing trips relies on files and emails you provide, and TATO cannot change anything on Turo. You remain bound by Turo's own terms.",
            ],
          },
          {
            heading: "Payments",
            body: [
              "Bookings on your website are paid to your own Stripe account; you are the seller of the rental and are responsible for its taxes, refunds and disputes. A platform fee is deducted from each payment as shown in TATO. Subscription fees, where they apply, are shown on the billing page.",
            ],
          },
          {
            heading: "Contracts and templates",
            body: [
              "Rental agreement templates, policies and pages TATO provides are starting points, not legal advice. You are responsible for their content and for using them lawfully.",
            ],
          },
          {
            heading: "Acceptable use",
            body: [
              "Do not use TATO to break the law, to send unsolicited messages, to interfere with the service, or to access other workspaces.",
            ],
          },
          {
            heading: "Availability and liability",
            body: [
              "We work to keep TATO available and your data safe, but provide it as is. To the extent the law allows, we are not liable for indirect or consequential losses, and our total liability is limited to the fees you paid us in the 12 months before the claim.",
            ],
          },
          {
            heading: "Ending",
            body: [
              "You may stop using TATO at any time and ask for an export of your data. We may suspend an account that breaks these terms, after notice where we reasonably can.",
            ],
          },
          {
            heading: "Law and contact",
            body: [
              `These terms are governed by the laws of ${f.jurisdiction}.`,
              `${f.entity} · ${f.address} · ${f.email}`,
            ],
          },
        ],
      }),
    },
  },
  zh: {
    legal: {
      privacyLink: "隐私政策",
      termsLink: "条款",
      effective: (date: string) => `生效日期 ${date}`,
      draftBanner: "草稿，尚未正式发布：部分信息还没填写，且这份文本未经律师审阅。",
      governingNote: "译文与英文原文不一致时，以英文为准。",
      backHome: "返回首页",
      bookingConsent: (brand: string) => `预订即表示你同意 ${brand} 的预订条款和隐私政策。`,

      renterPrivacy: (f: { brand: string; contact: string | null; address: string | null; cancellation: string; analytics: boolean }) => ({
        title: "隐私政策",
        intro: `${f.brand}（"我们"）通过本网站出租车辆。本政策说明你浏览和预订时我们收集哪些信息、为什么需要、还有谁会经手，以及你可以向我们提出哪些要求。`,
        sections: [
          {
            heading: "我们收集什么",
            body: [
              "预订信息：你的姓名、邮箱、电话、所订车辆、取还车时间和地点，以及你选择的附加项目。",
              "驾照：结账时上传的驾照照片，以及是否为本地（BC 省）驾照。用于确认你可以驾驶该车，并适用正确的保险费率。",
              "租车合同上的签名，以及签署时间、签署时使用的 IP 地址和浏览器，作为合同记录。",
              "付款：银行卡付款由 Stripe 处理，我们看不到也不保存完整卡号。我们保留每笔付款的记录；如果你在结账时同意，Stripe 会保存你的卡，以便收取租车合同允许的行程后费用（加天、超出公里、车损）。",
              "取车和还车时的检查照片和里程读数，包括相机记录的拍摄时间和地点。",
              "你发给我们的内容：改期、取消申请以及关于预订的其他消息。",
              ...(f.analytics
                ? [
                    "网站使用：本网站使用 Google Analytics 和/或 Google Ads 标签，通过 Cookie 记录访问的页面以及是否完成预订。你可以在浏览器中屏蔽这些 Cookie。",
                  ]
                : []),
            ],
          },
          {
            heading: "我们为什么使用",
            body: [
              "为了接受和管理你的预订、履行租车合同；确认你具备驾驶资格并已投保；收款以及收取和退还押金；在发生车损或争议时保留车况和约定内容的证据；就你的预订联系你（确认、提醒、变更）；以及履行法律、税务和保险方面的义务。",
              "我们不出售你的信息；除非你要求，我们不会向你发送营销信息。",
            ],
          },
          {
            heading: "还有谁会经手",
            body: [
              "Stripe：处理付款并保存你同意保存的银行卡。",
              "运行本网站并代我们保存预订记录的预订软件服务商，以及它使用的托管和邮件发送服务。它们只能为向我们提供该服务而处理你的信息。",
              "在理赔、违章或法律要求时：我们的保险公司（如 ICBC）、警方或其他主管部门，以及过路费、停车管理机构。",
              "你的信息可能在你所在省份或国家以外（包括美国）存储和处理。",
            ],
          },
          {
            heading: "保存多久",
            body: [
              "未付款的结账留下的驾照照片和签名，7 天后删除。",
              "已完成的预订，我们会在完成租车、处理理赔、满足税务和法律存档要求所需的期限内（一般最长 7 年）保留预订记录、已签合同、付款记录和检查照片，之后删除。",
            ],
          },
          {
            heading: "你的选择",
            body: [
              "你可以要求查看我们保存的你的信息、更正，或在我们没有义务保留时删除。请通过下方方式联系我们。",
              "如对我们的答复不满意，你可以向不列颠哥伦比亚省信息与隐私专员办公室（OIPC BC）投诉。",
            ],
          },
          {
            heading: "安全",
            body: ["本网站使用加密连接（HTTPS），预订记录只有需要的人员才能访问，银行卡信息保存在 Stripe。"],
          },
          {
            heading: "变更与联系",
            body: [
              "我们可能会更新本政策，页首日期为最后修改日期。",
              `问题或请求：${[f.brand, f.contact, f.address].filter(Boolean).join(" · ")}。`,
            ],
          },
        ],
      }),

      renterTerms: (f: { brand: string; contact: string | null; address: string | null; cancellation: string; analytics: boolean }) => ({
        title: "预订条款",
        intro: `你通过本网站向 ${f.brand}（"我们"）预订车辆时适用本条款。租车本身以你预订时签署的租车合同为准。`,
        sections: [
          {
            heading: "预订与付款",
            body: [
              "付款前显示的价格已包含租金、保险、附加项目和费用以及税费，预订时通过 Stripe 一次性收取。",
              "如显示押金，押金在预订时收取，行程结束后扣除租车合同规定的应付款项后退还。",
              "付款成功并收到我们的确认邮件后，预订即确认。",
            ],
          },
          {
            heading: "租车合同",
            body: [
              "你在预订页签署租车合同。合同规定租车规则：谁可以驾驶、车辆如何使用、每日公里额度、油量、车损、保险和押金。本条款与合同不一致时，租车事项以合同为准。",
            ],
          },
          {
            heading: "驾驶人",
            body: ["每位驾驶人都必须持有有效驾照。如果我们无法确认驾照，可以取消预订并全额退款。"],
          },
          {
            heading: "改期与取消",
            body: [
              "通过确认邮件中的链接申请改期或取消，每项变更都由我们确认。",
              `取消政策：${f.cancellation}押金始终全额退还。`,
              "新日期按当前价格计算。更贵则补收差价；更便宜且在免费取消期限前申请，则退还差价。",
              "如因我们的原因无法提供车辆，我们会提供替代方案或全额退款。",
            ],
          },
          {
            heading: "行程后的费用",
            body: [
              "加天、超出公里额度、油费、过路费、罚单和车损，按租车合同的规定，从预订时保存的银行卡扣款，或通过我们发送的付款链接收取。",
            ],
          },
          {
            heading: "检查照片",
            body: ["请在取车和还车时通过预订页为车辆拍照。你的照片和我们的照片会作为车况记录。"],
          },
          {
            heading: "本网站",
            body: [
              "我们尽力保证价格、空闲情况和描述准确。照片展示的是车型，细节可能与实际车辆不同。预订付款后价格即锁定。",
              "本条款不限制你依法不可被限制的任何权利。",
            ],
          },
          {
            heading: "适用法律与联系",
            body: [
              "本条款受不列颠哥伦比亚省法律及在该省适用的加拿大联邦法律管辖。",
              `问题：${[f.brand, f.contact, f.address].filter(Boolean).join(" · ")}。`,
            ],
          },
        ],
      }),

      platformPrivacy: (f: { entity: string; address: string; email: string; jurisdiction: string }) => ({
        title: "TATO 隐私政策",
        intro: `${f.entity}（"我们"）提供 TATO，供租车运营方管理车队、导入 Turo 行程，并在自己的网站上接受预订。本政策说明我们在提供服务时如何处理信息。`,
        sections: [
          {
            heading: "两种角色",
            body: [
              "对于你本人的账号信息，我们按本政策决定如何使用。",
              "你录入 TATO 的他人信息（租客、Turo 客人、车主、员工），由我们代你、按你的指示处理，用于向你提供服务。你需要确保有权收集这些信息，并告知相关人员如何使用。TATO 为每个租车网站提供可审阅和修改的隐私政策和预订条款。",
            ],
          },
          {
            heading: "我们收集什么",
            body: [
              "账号：你的姓名、邮箱和经过哈希处理的密码，你的工作区以及你邀请的成员。",
              "车队和订单：你创建或上传的车辆、车主、订单、日历、价格、照片、文件和合同；通过 CSV 或预订邮件导入的 Turo 行程；客人消息；员工排班。",
              "你网站上的预订：租客结账时填写的内容（见网站的隐私政策）、检查照片、已签合同。",
              "付款：你的 Stripe 账户标识和打款状态。银行卡信息在 Stripe 自己的页面输入，不经过我们的服务器。",
              "工作区内的操作记录，以及运行和保护服务所需的技术信息（例如登录时间和 IP 地址）。",
            ],
          },
          {
            heading: "邮箱访问",
            body: [
              "如果你连接了邮箱，TATO 只读取来自 Turo 的邮件（预订、改期、取消通知和客人消息），用于导入行程和消息；不会用你的邮箱发信，也不读取其他邮件。",
              "TATO's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.（TATO 对通过 Google API 获得的信息的使用和向其他应用的传输，遵守 Google API 服务用户数据政策，包括其中的有限使用要求。）邮箱中的信息不用于广告、不出售，也不用于训练 AI 模型。",
            ],
          },
          {
            heading: "服务商",
            body: [
              "Railway（应用托管、数据库和文件存储，位于美国）；Stripe（付款和打款）；Resend 或你自己的 SMTP 服务商（发送邮件）；Moonshot AI（AI 助理、消息翻译、读取预订邮件，只发送功能所需的文本）；Twilio（短信，如启用）；腾讯微信（员工通知，如启用）；Google（你的邮箱，如已连接）。",
              "它们只能为提供各自的服务而处理信息。",
            ],
          },
          {
            heading: "保存多久",
            body: [
              "账号有效期间一直保存。删除的订单在回收站中保留，直到你清空。注销账号后，我们会在 30 天内删除你的工作区，法律要求保留的内容和按周期自动过期的备份除外。",
            ],
          },
          {
            heading: "你的权利",
            body: [
              `你可以发邮件到 ${f.email}，要求获取、更正或删除你的信息，也可以向不列颠哥伦比亚省信息与隐私专员办公室投诉。`,
            ],
          },
          {
            heading: "安全",
            body: ["连接经过加密，密码以哈希形式保存，各工作区的数据相互隔离，只有运营服务的人员可以访问。"],
          },
          {
            heading: "变更与联系",
            body: [
              "我们可能会更新本政策，页首日期为最后修改日期；重大变更会通知账号持有人。",
              `${f.entity} · ${f.address} · ${f.email}`,
            ],
          },
        ],
      }),

      platformTerms: (f: { entity: string; address: string; email: string; jurisdiction: string }) => ({
        title: "TATO 服务条款",
        intro: `本条款是你与 ${f.entity}（"我们"）之间关于使用 TATO 的协议。创建账号或使用 TATO 即表示你接受本条款。`,
        sections: [
          {
            heading: "服务内容",
            body: [
              "TATO 帮助租车运营方管理车辆、车主、日历和订单，导入 Turo 行程，发布预订网站，通过 Stripe 收款，以及签署租车合同。功能可能随时间调整。",
            ],
          },
          {
            heading: "你的账号",
            body: ["请妥善保管登录信息。你对工作区内发生的事情负责，包括你邀请的成员的操作。"],
          },
          {
            heading: "你的数据",
            body: [
              "你的数据归你所有。你允许我们存储和处理这些数据，仅用于向你提供 TATO。你需要合法收集租客、客人、车主和员工的信息，并对你向他们提供的告知负责。",
            ],
          },
          {
            heading: "Turo",
            body: [
              "TATO 与 Turo 没有关联，也未获 Turo 认可。导入行程依赖你提供的文件和邮件，TATO 无法修改 Turo 上的任何内容。你仍须遵守 Turo 自己的条款。",
            ],
          },
          {
            heading: "付款",
            body: [
              "你网站上的预订款项付到你自己的 Stripe 账户；你是租车服务的卖方，负责相关税费、退款和争议。每笔付款会按 TATO 中显示的标准扣除平台费。适用的订阅费用显示在账单页面。",
            ],
          },
          {
            heading: "合同和模板",
            body: ["TATO 提供的租车合同模板、政策和页面仅供参考，不构成法律意见。你对其内容和合法使用负责。"],
          },
          {
            heading: "使用规范",
            body: ["不得利用 TATO 违法、发送未经请求的信息、干扰服务或访问其他工作区。"],
          },
          {
            heading: "可用性与责任",
            body: [
              "我们会尽力保持 TATO 可用并保护你的数据，但按现状提供服务。在法律允许的范围内，我们不对间接或后果性损失负责，我们的总责任以索赔前 12 个月你向我们支付的费用为限。",
            ],
          },
          {
            heading: "终止",
            body: [
              "你可以随时停止使用 TATO 并要求导出数据。对违反本条款的账号，我们可以在合理可行时事先通知后暂停。",
            ],
          },
          {
            heading: "适用法律与联系",
            body: [`本条款受 ${f.jurisdiction} 法律管辖。`, `${f.entity} · ${f.address} · ${f.email}`],
          },
        ],
      }),
    },
  },
} as const;
