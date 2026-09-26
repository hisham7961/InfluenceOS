/**
 * Arabic column headers for CSV downloads (reports and the creator export),
 * keyed by the English header. Terms follow docs/localization/ar-glossary.md.
 * A header with no entry stays in English rather than being guessed.
 */
const AR: Record<string, string> = {
  // Reports
  Brand: 'العلامة التجارية',
  Budget: 'الميزانية',
  Campaign: 'الحملة',
  Campaigns: 'الحملات',
  Completion: 'نسبة الإنجاز',
  'Eng. Rate': 'معدل التفاعل',
  Engagement: 'التفاعل',
  Followers: 'المتابعون',
  Influencer: 'المؤثر',
  Influencers: 'المؤثرون',
  'Metrics Synced': 'آخر تحديث للأرقام',
  Platform: 'المنصة',
  'Published Content': 'المحتوى المنشور',
  'Published Deliverables': 'المحتوى المطلوب المنشور',
  Source: 'المصدر',
  Spend: 'الإنفاق',
  Status: 'الحالة',
  'Total Deliverables': 'إجمالي المحتوى المطلوب',
  'Total Paid': 'إجمالي المدفوع',
  Variance: 'الفرق عن الميزانية',
  Views: 'المشاهدات',
  // Creator export
  ID: 'المعرّف',
  'Display Name': 'الاسم الظاهر',
  'Full Name': 'الاسم الكامل',
  'Primary Username': 'اسم المستخدم الرئيسي',
  'Primary Platform': 'المنصة الرئيسية',
  Platforms: 'المنصات',
  'Total Followers': 'إجمالي المتابعين',
  Category: 'الفئة',
  Country: 'الدولة',
  City: 'المدينة',
  'Relationship Status': 'حالة العلاقة',
  Priority: 'الأولوية',
  'Audience Health': 'جودة الجمهور',
  Email: 'البريد الإلكتروني',
  Mobile: 'الجوال',
  WhatsApp: 'واتساب',
  'Manager Name': 'اسم المدير',
  'Manager Contact': 'تواصل المدير',
  'Preferred Contact': 'وسيلة التواصل المفضلة',
  Languages: 'اللغات',
  Tags: 'الوسوم',
  Owner: 'المسؤول',
  Active: 'نشط',
  'Created At': 'تاريخ الإضافة',
};

export type CsvLocale = 'en' | 'ar';

export function csvHeader(label: string, locale: CsvLocale): string {
  return locale === 'ar' ? (AR[label] ?? label) : label;
}
