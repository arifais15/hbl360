const employeeImportFields = [
  { key: 'emp_code', label: 'পে আইডি / কর্মচারী কোড', required: true, description: '১-৪ সংখ্যার পে আইডি দিন; সিস্টেম ৪ সংখ্যার কোডে রূপান্তর করবে।' },
  { key: 'name', label: 'কর্মকর্তা/কর্মচারীর পূর্ণ নাম', required: true, description: 'অফিসিয়াল নথি অনুযায়ী পুরো নাম লিখুন।' },
  { key: 'designation', label: 'পদবী', required: true, description: 'বর্তমান অফিসিয়াল পদবী লিখুন।' },
  { key: 'department', label: 'বিভাগ', required: false, description: 'বিভাগের নাম; ফাঁকা থাকলে জেনারেল/প্রশাসন হবে।' },
  { key: 'mobile', label: 'মোবাইল নম্বর', required: false, description: 'মোবাইল নম্বর টেক্সট হিসেবে লিখুন যাতে শুরুতে ০ বাদ না যায়।' },
  { key: 'email', label: 'ইমেইল ঠিকানা', required: false, description: 'অফিসিয়াল বা যোগাযোগের ইমেইল ঠিকানা।' },
  { key: 'joining_date', label: 'যোগদানের তারিখ', required: false, description: 'তারিখ YYYY-MM-DD ফরম্যাটে দিন; যেমন 2020-05-15।' },
  { key: 'current_posting_pbs', label: 'বর্তমান পদায়ন / পবিস', required: false, description: 'বর্তমান পদায়নকৃত পবিস; ফাঁকা থাকলে নিজস্ব পবিস হবে।' }
];

const employeeTemplateOptions = {
  filename: 'employee_import_template.xlsx',
  title: 'কর্মকর্তা ও কর্মচারী আমদানি টেমপ্লেট',
  subtitle: 'পবিস গৃহ ঋণ ব্যবস্থাপনা সিস্টেম | কর্মচারী তথ্য নিবন্ধন',
  examples: [{
    emp_code: '0001',
    name: 'উদাহরণ কর্মচারী',
    designation: 'উদাহরণ পদবী',
    department: 'অর্থ ও হিসাব বিভাগ',
    mobile: '01700000000',
    email: 'example@pbs.gov.bd',
    joining_date: '2020-01-15',
    current_posting_pbs: 'নিজস্ব পবিস'
  }]
};

const loanImportFields = [
  { key: 'employee_code', label: 'কর্মচারীর পে আইডি', required: true, description: 'পে আইডি কর্মচারী তালিকায় আগে থেকে থাকতে হবে।' },
  { key: 'loan_no', label: 'ঋণ হিসাব নম্বর', required: true, description: 'প্রতিটি ঋণের জন্য আলাদা/অনন্য হিসাব নম্বর দিন।' },
  { key: 'loan_lot_name', label: 'ঋণের লট', required: false, description: 'যেমন ১ম বরাদ্দ/লট; ফাঁকা থাকলে ১ম ঋণ হবে।' },
  { key: 'loan_source_type', label: 'ঋণের উৎস ধরন', required: false, description: 'OWN_PBS অথবা OTHER_PBS; ফাঁকা থাকলে OWN_PBS হবে।' },
  { key: 'origin_pbs_name', label: 'উৎস পবিসের নাম', required: false, description: 'OTHER_PBS হলে উৎস পবিসের নাম দিন।' },
  { key: 'sanction_no', label: 'মঞ্জুরি নম্বর', required: false, description: 'অনুমোদিত মঞ্জুরি নম্বর।' },
  { key: 'sanction_date', label: 'মঞ্জুরির তারিখ', required: false, description: 'তারিখ YYYY-MM-DD ফরম্যাটে দিন।' },
  { key: 'disbursement_date', label: 'ঋণ বিতরণের তারিখ', required: false, description: 'তারিখ YYYY-MM-DD ফরম্যাটে দিন।' },
  { key: 'sanction_amount', label: 'মঞ্জুরিকৃত ঋণের পরিমাণ', required: true, description: 'মঞ্জুরিপত্রে উল্লেখিত মোট টাকার অঙ্ক।' },
  { key: 'disbursed_amount', label: 'মোট বিতরণকৃত ঋণ', required: true, description: 'কর্মচারীকে প্রকৃতপক্ষে বিতরণ করা মোট টাকা।' },
  { key: 'opening_principal_balance', label: 'Opening date-এ আসল স্থিতি', required: true, description: 'Opening balance date-এ অবশিষ্ট আসলের পরিমাণ।' },
  { key: 'opening_interest_balance', label: 'Opening date-এ সুদ স্থিতি', required: true, description: 'অবশিষ্ট সুদের পরিমাণ; সুদ না থাকলে 0 দিন।' },
  { key: 'monthly_installment', label: 'মাসিক কিস্তির পরিমাণ', required: true, description: 'নির্ধারিত মাসিক কিস্তির টাকার অঙ্ক।' },
  { key: 'opening_balance_date', label: 'Opening balance-এর তারিখ', required: true, description: 'যে তারিখ পর্যন্ত বর্তমান আসল/সুদ স্থিতি হিসাব করা; YYYY-MM-DD।' },
  { key: 'remarks', label: 'মন্তব্য', required: false, description: 'প্রয়োজনে অতিরিক্ত তথ্য লিখুন।' }
];

const loanTemplateOptions = {
  filename: 'loan_opening_balance_import_template.xlsx',
  title: 'ঋণ Opening Balance আমদানি টেমপ্লেট',
  subtitle: 'পবিস গৃহ ঋণ ব্যবস্থাপনা সিস্টেম | বিদ্যমান ঋণের প্রারম্ভিক স্থিতি',
  examples: [{
    employee_code: '0001',
    loan_no: 'EXAMPLE-LOAN-001',
    loan_lot_name: '১ম বরাদ্দ/লট',
    loan_source_type: 'OWN_PBS',
    origin_pbs_name: '',
    sanction_no: 'EXAMPLE-SANCTION',
    sanction_date: '2020-01-15',
    disbursement_date: '2020-02-01',
    sanction_amount: 500000,
    disbursed_amount: 500000,
    opening_principal_balance: 350000,
    opening_interest_balance: 0,
    monthly_installment: 5000,
    opening_balance_date: '2026-06-30',
    remarks: 'শুধু উদাহরণ; বাস্তব অনুমোদিত তথ্য দিয়ে প্রতিস্থাপন করুন'
  }]
};

const otherPbsImportFields = [
  { key: 'pbs_name', label: 'পবিসের নাম', required: true, description: 'অন্যান্য পল্লী বিদ্যুৎ সমিতির পূর্ণ নাম; প্রতিটি নাম অনন্য হতে হবে।' },
  { key: 'short_name', label: 'সংক্ষিপ্ত নাম / কোড', required: false, description: 'যেমন Coxs Bazar PBS।' },
  { key: 'bank_name', label: 'ব্যাংকের নাম', required: false, description: 'সমিতির ব্যাংকের নাম।' },
  { key: 'bank_branch', label: 'ব্যাংক শাখা', required: false, description: 'ব্যাংকের শাখার নাম ও অবস্থান।' },
  { key: 'account_no', label: 'হিসাব নম্বর', required: false, description: 'ব্যাংক হিসাব নম্বর; শুরুতে শূন্য থাকলে Text format ব্যবহার করুন।' },
  { key: 'routing_no', label: 'রাউটিং নম্বর', required: false, description: 'ব্যাংকের রাউটিং নম্বর; শুরুতে শূন্য থাকলে Text format ব্যবহার করুন।' },
  { key: 'contact_person', label: 'যোগাযোগ ব্যক্তির নাম', required: false, description: 'ঐচ্ছিক যোগাযোগের নাম।' },
  { key: 'phone', label: 'ফোন নম্বর', required: false, description: 'ফোন নম্বর; শুরুতে শূন্য থাকলে Text format ব্যবহার করুন।' },
  { key: 'email', label: 'ইমেইল', required: false, description: 'যোগাযোগের ইমেইল ঠিকানা।' }
];

const otherPbsTemplateOptions = {
  filename: 'other_pbs_directory_import_template.xlsx',
  title: 'অন্যান্য পবিস ডিরেক্টরি আমদানি টেমপ্লেট',
  subtitle: 'শুধু পবিসের নাম আবশ্যক; বিদ্যমান পবিসের তথ্য পরিবর্তন হবে না।',
  examples: [{
    pbs_name: 'উদাহরণ পল্লী বিদ্যুৎ সমিতি',
    short_name: 'Example PBS',
    bank_name: 'অগ্রণী ব্যাংক পিএলসি',
    bank_branch: 'উদাহরণ শাখা',
    account_no: '0200000000000',
    routing_no: '010000000',
    contact_person: '',
    phone: '01700000000',
    email: ''
  }]
};

module.exports = {
  employeeImportFields,
  employeeTemplateOptions,
  loanImportFields,
  loanTemplateOptions,
  otherPbsImportFields,
  otherPbsTemplateOptions
};
