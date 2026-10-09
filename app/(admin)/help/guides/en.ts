import type { Guide, HelpCopy } from "./types";

export const copy: HelpCopy = {
  title: "Help",
  intro: "How to use every page of TATO: what it is for, where the buttons are, and what to watch for. Screenshots come from a demo account; yours shows your own cars and trips.",
  pick: "Choose a page",
  open: "Open this page",
  steps: "Steps",
  tips: "Good to know",
  screenshotAlt: "Screenshot of {page}",
  screenshotNote: "Demo account. Click to enlarge.",
  contactTitle: "Still stuck?",
  contactBody: "Press Contact at the bottom left, describe the problem and attach a screenshot or screen recording. We reply as soon as we can.",
};

export const guides: Guide[] = [
  {
    key: "dashboard",
    title: "Dashboard",
    summary: "Start each day here: who picks up and returns today and tomorrow, any overlapping trips, and how the month is going.",
    sections: [
      {
        heading: "See today's work",
        steps: [
          "The row of numbers at the top is Today in use, Pickups today, Returns today and Conflicts. A red conflict count comes first.",
          "The today list shows every handover by time: a black tag is a return, a white one a pickup, with the place after the car.",
          "The tomorrow list is the same for tomorrow, so deliveries and cleaning can be planned a day ahead.",
          "Click any row to open that trip.",
        ],
      },
      {
        heading: "Get back to a trip you just looked at",
        steps: [
          "Recently viewed lists the last three trips you opened.",
          "Recent actions is folded; click its title to see what the team changed, or go on to the full Activity log.",
        ],
      },
      {
        heading: "New account: follow the checklist",
        steps: [
          "Getting started lists six steps: add your cars, bring in your Turo trips, add the owners, set each owner's terms, share a statement, invite your team.",
          "Click an unfinished step to go to its page. The list disappears when all six are done, or press Hide.",
        ],
      },
    ],
    tips: [
      "Net earnings, Trips, Active vehicles and Avg per trip count this month's imported trips. A Turo trip has an amount only after its CSV is imported.",
    ],
  },
  {
    key: "assistant",
    title: "Assistant",
    summary: "Alerts that need you, an AI you can ask about the fleet, and the Turo emails pulled in automatically.",
    sections: [
      {
        heading: "Handle alerts",
        steps: [
          "Alerts are found by rules in code, for example a website booking whose dates you must block on Turo by hand, or Turo email sync that stopped.",
          "Press Open to deal with it, then Got it. An alert also closes itself when its condition clears.",
          "Rescan checks again right away.",
        ],
      },
      {
        heading: "Ask the assistant",
        steps: [
          "Type a question, such as \"What's happening today?\" or \"How much did I earn this month?\", or press one of the examples.",
          "Answers come from your live data.",
          "Under What the AI remembers, write a rule it should always follow and press Remember. Answers and guest-reply drafts follow it from then on.",
        ],
      },
      {
        heading: "Turo inbox",
        steps: [
          "Emails from Turo arrive here, the ones needing a reply first.",
          "Sync now fetches new mail immediately.",
        ],
      },
    ],
    tips: ["Turo cannot be written to: when a car is booked on your own website, someone has to block those dates on Turo, or the car can be booked twice."],
  },
  {
    key: "messages",
    title: "Messages",
    summary: "Every Turo guest message, grouped by conversation, with a translation beside it.",
    sections: [
      {
        heading: "Find what needs a reply",
        steps: [
          "Switch between All, Needs reply and Scheduled at the top; the numbers are counts.",
          "The list on the left shows the guest, the car and the latest message.",
          "Click a conversation to read all of it on the right.",
        ],
      },
      {
        heading: "Reply and clear it",
        steps: [
          "Press Turo to open the conversation on Turo and reply there.",
          "Switch between Translation and Summary.",
          "When it is handled, press Mark handled and it leaves Needs reply.",
          "Trip opens the booking the message is about.",
        ],
      },
    ],
    tips: ["Car not identified means the email's make and model fit several cars, or none. TATO never guesses; set the car on the trip yourself."],
  },
  {
    key: "updates",
    title: "Updates",
    summary: "Everything that happens on Turo as one timeline: new bookings, changes, cancellations, pickups, returns, payouts and guest messages.",
    sections: [
      {
        heading: "Filter by kind",
        steps: [
          "Press a chip at the top to see one kind: Guest message, New booking, Trip changed, Cancelled, Picked up, Returned, Payout, Support.",
          "Needs a reply shows only guest messages still waiting.",
        ],
      },
      {
        heading: "Jump to the details",
        steps: [
          "Each entry has Order, Conversation and Open on Turo ↗.",
          "Order opens the trip in TATO, Conversation the guest thread, Open on Turo the original page.",
        ],
      },
    ],
  },
  {
    key: "calendar",
    title: "Calendar",
    summary: "Every car on one timeline: which days it is booked, free or in for service, at a glance.",
    sections: [
      {
        heading: "Read the calendar",
        steps: [
          "Each row is a car and each column a day. The column headed Today is today, and the purple line is the current time.",
          "Bar colours are in the legend at the top: blue is not with the owner yet, green is with the owner or offline, red is an overlap, striped amber is service, a dashed grey strip is cancelled.",
          "Trips that are over are faded. Two trips less than six hours apart get an amber ⇄ marker at the handover, so the car is turned around in time.",
          "Drag the empty grid sideways to move through dates, or use ‹ › and Today.",
        ],
      },
      {
        heading: "Add a trip, a service record or a note",
        steps: [
          "On a car's row, click the first day and then the last; the days between are picked.",
          "A bar appears at the bottom: Create order for an offline trip, New service record for maintenance or repairs.",
          "To leave a note, type it in Note on the same bar and press Enter.",
          "New and New service record at the top do the same without picking days.",
        ],
      },
      {
        heading: "Open and edit a trip",
        steps: [
          "Click a bar to open the trip. The chips at the top say where it stands, such as \"Returns tomorrow 14:00\".",
          "The pencil beside a field edits it; save or press Enter, and Esc cancels.",
          "View Turo receipt and View on Turo open the trip on Turo; Sync to owner share puts it in the owner's ledger.",
          "Empty fields wait under Add, such as deposit, payment method and contract number.",
        ],
      },
      {
        heading: "More tools",
        steps: [
          "The small square beside a plate opens that car's month view, which pages back and forward for years.",
          "Filters narrows by car, owner and source; the search box at the top right finds renters, phones, plates, owners and notes.",
          "Tools has bulk selection, calendar feeds, the order export and the day width.",
        ],
      },
    ],
    tips: [
      "A car can hold overlapping trips: saving works, the bar turns red, and the trip names what it clashes with.",
      "The small numbers on free days are that car's price on your own booking website, shown only for cars open to direct booking.",
    ],
  },
  {
    key: "orders",
    title: "Orders",
    summary: "Every trip in one list: search, filter, export, create offline trips and act on many at once.",
    sections: [
      {
        heading: "Find a trip",
        steps: [
          "Type a renter, car, plate, owner, phone, date, note or order number into the search and press Search.",
          "Filters narrows by status, source, car and dates; press Apply filters.",
          "Click a row to open the trip, in the same panel the calendar uses.",
        ],
      },
      {
        heading: "Create an offline trip",
        steps: [
          "Press + beside Offline booking desk.",
          "Choose the car and fill in renter, phone, pickup and return times and places, price, deposit and payment method.",
          "Save. The trip appears on the calendar, with a warning if it overlaps another.",
        ],
      },
      {
        heading: "Act on many and export",
        steps: [
          "Tick the boxes beside trips, or Select all on this page.",
          "A bar appears at the bottom: sync to owners or delete in bulk; offline trips can also be marked paid together.",
          "Export to Excel exports the trips the filters show.",
        ],
      },
    ],
    tips: [
      "A Turo trip's amount is what Turo pays you after its fees, and arrives with the CSV; until then it shows —.",
      "Deleted trips go to the Trash, where they can be restored.",
    ],
  },
  {
    key: "imports",
    title: "CSV Imports",
    summary: "Bring in Turo's earnings CSV. Trip amounts, fee breakdowns and owner payouts all come from it.",
    sections: [
      {
        heading: "Import a CSV",
        steps: [
          "Step 1: export the CSV from Turo's earnings page (Open Turo earnings page), then press Choose file.",
          "Step 2: pick which Turo account the file is from. The wrong one files the cars under another account.",
          "Step 3: press Import. Cars that are not in your fleet yet are listed for you to confirm before they are created.",
        ],
      },
      {
        heading: "After importing",
        steps: [
          "The import log lists each file with its time, rows and result.",
          "Check these lists upcoming trips whose car was never confirmed by plate; open them and confirm each.",
          "Sync source settings sets up the automatic Turo email feed.",
        ],
      },
    ],
    tips: [
      "Importing the same CSV again updates trips rather than duplicating them.",
      "Past the free vehicle allowance, buy enough slots under Buy Quota before importing.",
    ],
  },
  {
    key: "vehicles",
    title: "Vehicles",
    summary: "Each car's details: plate, model, owner, cleaning fee, TATO commission and trip count.",
    sections: [
      {
        heading: "Add and edit cars",
        steps: [
          "Press + beside Create vehicle and fill in plate, make, model and year, and choose the owner.",
          "Edit vehicle changes the details, including the cleaning fee, Turo plan % and pickup password.",
          "Search by plate, model or owner.",
        ],
      },
      {
        heading: "A car you no longer rent",
        steps: ["Archive vehicle. New trips are no longer assigned to it, and its past trips and ledger stay."],
      },
    ],
    tips: [
      "The cleaning fee has a start date: a change applies to trips starting on or after it.",
      "Turo plan % is the share Turo pays you (blank means 75%). Owner splits use it when kept fees come off at the price the guest paid.",
    ],
  },
  {
    key: "vehicle-roi",
    title: "Vehicle returns",
    summary: "What each car has earned and how long it takes to pay back, plus rent estimates before you buy the next one.",
    sections: [
      {
        heading: "Fleet performance",
        steps: [
          "Fleet lists each car's earnings for the last 6 months, this month and 12 months, with earnings per km and annual return.",
          "Click a column header to sort.",
          "Enter a car's purchase price on the car to get its annual return.",
        ],
      },
      {
        heading: "Before you buy",
        steps: [
          "Rental estimate takes a model and year and estimates its daily rate and monthly income with you.",
          "Which car to buy ranks candidate models by expected return.",
        ],
      },
    ],
  },
  {
    key: "owners",
    title: "Owner revenue share",
    summary: "Each owner's cars, terms, ledger and balance, and a read-only link to send them.",
    sections: [
      {
        heading: "Add an owner and set terms",
        steps: [
          "Press + New owner and enter a name and email.",
          "Open the owner, assign their cars, and set the commission and the fees that come off their revenue.",
          "How kept fees come off is At what Turo paid out or At the price the guest paid, set per owner.",
        ],
      },
      {
        heading: "Ledger and balance",
        steps: [
          "A trip synced to the owner goes into their ledger automatically.",
          "+ Quick reimbursement records something you paid for the owner, such as a repair or insurance.",
          "The balance on the owner's card is what you currently owe them.",
        ],
      },
      {
        heading: "Share with the owner",
        steps: [
          "On the owner's page press Create share link and send the link to the owner.",
          "They see their ledger, monthly statements and their cars' calendar, and cannot change anything.",
        ],
      },
    ],
  },
  {
    key: "direct-booking",
    title: "Direct Booking",
    summary: "Your own rental website: which cars are listed, prices, deposits, insurance, places and confirmation emails.",
    sections: [
      {
        heading: "List cars",
        steps: [
          "Vehicles lists every car; filter by Live, Not listed, No photos and more.",
          "Press Edit on a car to set its daily price, insurance, tax and photos, then list it.",
          "Preview shows the car as renters see it.",
        ],
      },
      {
        heading: "Website rules",
        steps: [
          "Pricing rules and Dynamic pricing decide each day's price; Deposits sets the deposit and its refund.",
          "Pickup & return, Confirmation email and Rental agreement set the places renters can choose, the email after booking and the agreement they sign.",
          "Change requests handles renters' date changes; Ads drafts listings for other sites; Rental website sets up the site itself.",
        ],
      },
    ],
    tips: ["While the banner says Stripe payouts are not connected, renters cannot pay on the site. Connect under Payouts first."],
  },
  {
    key: "staff-schedule",
    title: "Staff Schedule",
    summary: "Hand deliveries, returns and cleaning to staff, who see and finish them from a link on their phone.",
    sections: [
      {
        heading: "Assign tasks",
        steps: [
          "Upcoming deliveries / returns on the left lists the handovers by day.",
          "Drag a task card onto a staff card to assign it, or use Choose staff under the task.",
          "Tasks with nobody assigned wait under Unassigned.",
        ],
      },
      {
        heading: "Staff and pay",
        steps: [
          "Add staff adds someone; Copy link on their card gives the personal link to send them.",
          "Staff see their own tasks in the link, mark them done and can add sub-tasks.",
          "Staff pay works out pay from finished tasks; Templates sets the notifications staff receive.",
        ],
      },
    ],
  },
  {
    key: "contracts",
    title: "E-sign Contracts",
    summary: "Upload a contract template, place the fields to fill, and send it to the renter to sign online. This page is in Chinese for now, so its button names are quoted in Chinese.",
    sections: [
      {
        heading: "Prepare a template",
        steps: [
          "Press 「+ 创建合约模板」 (create template) and upload the contract PDF.",
          "In the template editor, place the fields to fill and where to sign, then save.",
          "An existing template has 「编辑模板」 (edit), 「查看 PDF」 (view) and 「删除模板」 (delete).",
        ],
      },
      {
        heading: "Send it to sign",
        steps: [
          "Under 「发送给租客签署」 (send to the renter), choose the template in 「选择模板」.",
          "In 「绑定订单（可选）」 pick the trip, and the renter, car and dates fill in by themselves.",
          "Enter the signer's name and email; 「+ 添加签署人」 adds another signer.",
          "Press 「发送签约邮件」 (send). The renter signs from the email; progress is under 「签约记录」 and finished PDFs under 「历史文档」.",
        ],
      },
    ],
  },
  {
    key: "inspections",
    title: "Condition Photos",
    summary: "Walk-around photos at each handover: evidence of the car's condition that stands up in a Turo claim.",
    sections: [
      {
        heading: "What still needs photos",
        steps: [
          "Waiting for photos lists the coming handovers and returns with no photos yet, and how many hours remain.",
          "The ones due now come first; Window closed are the ones already missed.",
        ],
      },
      {
        heading: "Finished walk-arounds",
        steps: [
          "The recent walk-arounds table shows the car, time, photographer, photo count and how complete it is.",
          "Open one to see all its photos. Under 100% means some angles were not taken.",
        ],
      },
    ],
    tips: ["Photos are taken in the condition-photo phone app, which guides you angle by angle and stamps the time."],
  },
  {
    key: "photos",
    title: "Photos & Videos",
    summary: "Every photo and video uploaded to trips and cars, in one place: find them by car and download them together.",
    sections: [
      {
        heading: "Find and download",
        steps: [
          "Pick a car under Vehicle, or search.",
          "Filter narrows by time or source.",
          "Download as ZIP downloads everything the filters show.",
        ],
      },
    ],
    tips: ["Photos are uploaded on a trip or a car; this page gathers them."],
  },
  {
    key: "documents",
    title: "Contract Files",
    summary: "Every contract and document uploaded to trips and cars, to find and download.",
    sections: [
      {
        heading: "Find and download",
        steps: [
          "Pick a car under Vehicle, or search by file name.",
          "Open file shows a document; Download as ZIP downloads them all.",
        ],
      },
    ],
    tips: ["Files are uploaded on a trip or a car; e-signed contracts appear here too."],
  },
  {
    key: "activity",
    title: "Activity log",
    summary: "Who changed what and when: every change to trips, cars, owners, notes and prices is recorded.",
    sections: [
      {
        heading: "Look something up",
        steps: [
          "Each entry says what was done, by whom and when.",
          "Filters narrows by person, kind or date.",
        ],
      },
    ],
    tips: ["When numbers do not add up, start here: who changed a trip's amount, when it was synced to the owner."],
  },
  {
    key: "trash",
    title: "Trash",
    summary: "Deleted trips wait here and can be put back on the calendar.",
    sections: [
      {
        heading: "Restore trips",
        steps: [
          "Press Restore on a trip to put it back on the calendar and in Orders.",
          "For several, tick them (or Select all) and press Restore on the bar at the bottom.",
        ],
      },
    ],
    tips: ["A deleted trip keeps its photos and files; they are all there after a restore."],
  },
  {
    key: "billing",
    title: "Buy Quota",
    summary: "Vehicle slots: the first five cars are free, and each one after that is paid monthly.",
    sections: [
      {
        heading: "Buy slots",
        steps: [
          "The top shows your current vehicles, the free allowance, paid slots and how many you still need.",
          "Enter the Listing quantity and press Continue to Stripe.",
          "With a coupon, enter it under Coupon code and press Apply coupon.",
        ],
      },
    ],
    tips: ["CSV imports stop while you are short of slots and continue once you have enough."],
  },
  {
    key: "payouts",
    title: "Payouts",
    summary: "Connect Stripe so a renter paying on your website pays straight into your account.",
    sections: [
      {
        heading: "Connect payouts",
        steps: [
          "Choose your country of operation, Canada or the United States.",
          "Press Start Stripe onboarding and finish identity and bank details on Stripe's pages.",
          "Once approved, Status shows connected and the cars on your website can take payment.",
        ],
      },
    ],
    tips: ["The platform fee is 5%, plus Stripe's card fee (about 2.9% + 30¢)."],
  },
  {
    key: "invoices",
    title: "Invoices & receipts",
    summary: "Charges outside Turo and your website: offline rentals, damage, a kept deposit.",
    sections: [
      {
        heading: "Write an invoice or receipt",
        steps: [
          "Press + New invoice or + New receipt.",
          "Fill in the recipient, items, prices, quantities and tax; it can be linked to a trip.",
          "Then Email it to the customer, or Print / PDF.",
        ],
      },
      {
        heading: "Follow up",
        steps: [
          "Switch the list between All, Invoice and Receipt; the outstanding total sits above it.",
          "When the customer pays, press Mark paid.",
        ],
      },
    ],
  },
  {
    key: "account-settings",
    title: "Account Settings",
    summary: "Company profile, login email and password, team members, language, appearance, and TATO on your phone.",
    sections: [
      {
        heading: "Account and security",
        steps: [
          "Company profile changes the company name and login display name; press Save profile.",
          "Login email and Password change how you sign in, after your current password.",
        ],
      },
      {
        heading: "Team members",
        steps: [
          "The account owner can invite partners and staff, each with their own login.",
          "Choose which pages each member can open, or which cars they see; a viewer can look but not change anything.",
        ],
      },
      {
        heading: "Look and phone",
        steps: [
          "Language: Auto, English, Simplified or Traditional Chinese.",
          "Appearance: light, dark or follow the phone.",
          "iPhone home screen walks you through adding TATO from Safari; on Android, download the APK.",
          "Turo reader and API tokens connect automatic Turo reading and AI tools.",
        ],
      },
    ],
  },
];
