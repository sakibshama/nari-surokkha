/**
 * Lightweight i18n for the Police Portal.
 *
 * Keyed by the English source string, so any untranslated text falls back to
 * English automatically. Use `useT()`: `const t = useT(); t('Cases')`.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Lang = 'en' | 'bn';

interface LangState {
  lang: Lang;
  toggleLang: () => void;
  setLang: (lang: Lang) => void;
}

export const useLangStore = create<LangState>()(
  persist(
    (set) => ({
      lang: 'en',
      toggleLang: () => set((s) => ({ lang: s.lang === 'en' ? 'bn' : 'en' })),
      setLang: (lang) => set({ lang }),
    }),
    { name: 'lang-storage' },
  ),
);

export const translations: Record<string, string> = {
  // ── Navigation & titles ──
  'Main': 'প্রধান',
  'Live Alerts': 'লাইভ সতর্কতা',
  'Live SOS Alerts Queue': 'লাইভ এসওএস সতর্কতা সারি',
  'Cases': 'মামলা',
  'Incidents': 'ঘটনা',
  'Reported Incidents': 'রিপোর্টকৃত ঘটনা',
  'Settings': 'সেটিংস',
  'Police Portal': 'পুলিশ পোর্টাল',
  'Case Details': 'মামলার বিবরণ',
  'Alert Details': 'সতর্কতার বিবরণ',

  // ── Identity ──
  'Nari Surokkha': 'নারী সুরক্ষা',
  'Government of Bangladesh': 'বাংলাদেশ সরকার',
  'National Women Safety Service': 'জাতীয় নারী নিরাপত্তা সেবা',
  'Officer': 'কর্মকর্তা',

  // ── Top bar ──
  'Alerts': 'সতর্কতা',
  'Logout': 'লগ আউট',
  'Toggle theme': 'থিম পরিবর্তন',
  'Language': 'ভাষা',

  // ── Login ──
  'Sign In': 'সাইন ইন',
  'Authenticating…': 'যাচাই করা হচ্ছে…',
  'Phone Number': 'ফোন নম্বর',
  'Badge Number': 'ব্যাজ নম্বর',
  'Badge Number, Email, or Phone': 'ব্যাজ নম্বর, ইমেইল, বা ফোন',
  'Sign in with your Badge Number, Email, or Phone': 'আপনার ব্যাজ নম্বর, ইমেইল, বা ফোন দিয়ে সাইন ইন করুন',
  'Authenticating...': 'যাচাই করা হচ্ছে...',
  'Password': 'পাসওয়ার্ড',
  'This system is monitored. Unauthorized access is prohibited.':
    'এই সিস্টেমটি পর্যবেক্ষণ করা হয়। অননুমোদিত প্রবেশ নিষিদ্ধ।',
  'Login failed. Please check your credentials.':
    'লগইন ব্যর্থ। অনুগ্রহ করে আপনার তথ্য যাচাই করুন।',

  // ── Alerts / dashboard ──
  'Live Feed': 'লাইভ ফিড',
  'Reconnecting…': 'পুনঃসংযোগ হচ্ছে…',
  'Refresh': 'রিফ্রেশ',
  'Active Emergencies': 'সক্রিয় জরুরি অবস্থা',
  'No active alerts': 'কোনো সক্রিয় সতর্কতা নেই',
  'No active SOS alerts': 'কোনো সক্রিয় এসওএস সতর্কতা নেই',
  'Real-time incoming emergency alerts from citizens in your jurisdiction.':
    'আপনার এখতিয়ারের নাগরিকদের কাছ থেকে রিয়েল-টাইম আগত জরুরি সতর্কতা।',
  'Active Dispatches': 'সক্রিয় প্রেরণ',
  'Search by victim or phone...': 'ভুক্তভোগী বা ফোন দিয়ে অনুসন্ধান...',
  'Action': 'কার্যক্রম',
  'Loading live alerts...': 'লাইভ সতর্কতা লোড হচ্ছে...',
  'No active emergency alerts at the moment.': 'এই মুহূর্তে কোনো সক্রিয় জরুরি সতর্কতা নেই।',
  'Unknown': 'অজ্ঞাত',
  'Track Live': 'লাইভ ট্র্যাক',
  'Respond': 'সাড়া দিন',
  'View Details': 'বিস্তারিত দেখুন',
  'SOS Emergency': 'এসওএস জরুরি',
  'Violence': 'সহিংসতা',
  'Fire': 'অগ্নিকাণ্ড',
  'Accident': 'দুর্ঘটনা',
  'Medical': 'চিকিৎসা',
  'NEW': 'নতুন',
  'CONFIRMED': 'নিশ্চিত',
  'RESPONDING': 'সাড়া দিচ্ছে',
  'RESOLVED': 'সমাধান হয়েছে',
  'DISMISSED': 'খারিজ',

  // ── Cases ──
  'Case Number': 'মামলা নম্বর',
  'Assigned Officer': 'নিযুক্ত কর্মকর্তা',
  'Open': 'খোলা',
  'In Progress': 'চলমান',
  'Closed': 'বন্ধ',
  'Assign Officer': 'কর্মকর্তা নিযুক্ত করুন',
  'Update Status': 'অবস্থা হালনাগাদ',
  'Add Note': 'নোট যোগ করুন',
  'Timeline': 'সময়রেখা',
  'Export Report': 'প্রতিবেদন রপ্তানি',

  // ── Common ──
  'Search': 'অনুসন্ধান',
  'Search…': 'অনুসন্ধান…',
  'Save': 'সংরক্ষণ',
  'Save Changes': 'পরিবর্তন সংরক্ষণ',
  'Cancel': 'বাতিল',
  'Delete': 'মুছুন',
  'Edit': 'সম্পাদনা',
  'Update': 'হালনাগাদ',
  'Close': 'বন্ধ',
  'Back': 'ফিরে যান',
  'Loading…': 'লোড হচ্ছে…',
  'No data': 'কোনো তথ্য নেই',
  'Name': 'নাম',
  'Phone': 'ফোন',
  'Status': 'অবস্থা',
  'Actions': 'কার্যক্রম',
  'Type': 'ধরন',
  'Location': 'অবস্থান',
  'Time': 'সময়',
  'Date': 'তারিখ',
  'Note': 'নোট',
  'Notes': 'নোট',
  'Victim': 'ভুক্তভোগী',
  'Details': 'বিবরণ',
  'Status updated': 'অবস্থা হালনাগাদ হয়েছে',
  'All': 'সব',
  'Total': 'মোট',
  'Created At': 'তৈরির সময়',
  'Description': 'বিবরণ',
  'Full Name': 'পূর্ণ নাম',

  // ── Cases page ──
  'Case Management': 'মামলা ব্যবস্থাপনা',
  'Manage and track active and closed investigations.': 'সক্রিয় ও বন্ধ তদন্ত পরিচালনা ও পর্যবেক্ষণ করুন।',
  'Search case number...': 'মামলা নম্বর দিয়ে অনুসন্ধান...',
  'No cases found.': 'কোনো মামলা পাওয়া যায়নি।',

  // ── Case detail ──
  'Case not found.': 'মামলা পাওয়া যায়নি।',
  'Back to Cases': 'মামলায় ফিরে যান',
  'Add Investigation Note': 'তদন্ত নোট যোগ করুন',
  'This case is closed.': 'এই মামলাটি বন্ধ।',
  'Enter detailed case notes here...': 'এখানে বিস্তারিত মামলার নোট লিখুন...',
  'Master Timeline': 'মূল সময়রেখা',
  'No timeline events recorded.': 'কোনো সময়রেখার ঘটনা রেকর্ড করা হয়নি।',
  'Update Case Status': 'মামলার অবস্থা হালনাগাদ',
  'Reason for closing': 'বন্ধ করার কারণ',

  // ── Incidents page ──
  'Safety Incidents': 'নিরাপত্তা ঘটনা',
  'Review anonymous community reports to update area safety scores.':
    'এলাকার নিরাপত্তা স্কোর হালনাগাদ করতে বেনামী কমিউনিটি প্রতিবেদন পর্যালোচনা করুন।',
  'Edit Incident': 'ঘটনা সম্পাদনা',
  'Update description...': 'বিবরণ হালনাগাদ...',

  // ── Settings page ──
  'Manage your officer profile and security preferences.':
    'আপনার কর্মকর্তা প্রোফাইল ও নিরাপত্তা পছন্দ পরিচালনা করুন।',
  'Officer Profile': 'কর্মকর্তার প্রোফাইল',
  'Badge Number (Read-only)': 'ব্যাজ নম্বর (শুধু পঠনযোগ্য)',
  'Full Name (Read-only)': 'পূর্ণ নাম (শুধু পঠনযোগ্য)',
  'Email Address': 'ইমেইল ঠিকানা',
  'Display Preferences': 'প্রদর্শন পছন্দ',
  'Theme Mode': 'থিম মোড',
  'Toggle between light and dark mode': 'লাইট ও ডার্ক মোডের মধ্যে পরিবর্তন করুন',
  'Security': 'নিরাপত্তা',
  'Current Password': 'বর্তমান পাসওয়ার্ড',
  'New Password': 'নতুন পাসওয়ার্ড',
  'Confirm New Password': 'নতুন পাসওয়ার্ড নিশ্চিত করুন',

  // ── Alert detail ──
  'Alert not found.': 'সতর্কতা পাওয়া যায়নি।',
  'Back to Dashboard': 'ড্যাশবোর্ডে ফিরে যান',
  'Alert Information': 'সতর্কতার তথ্য',
  'Live Location Map': 'লাইভ অবস্থান মানচিত্র',
  'Live Video Feed': 'লাইভ ভিডিও ফিড',
  'Evidence Uploaded': 'আপলোডকৃত প্রমাণ',
  'Loading evidence...': 'প্রমাণ লোড হচ্ছে...',
  'No evidence uploaded for this alert.': 'এই সতর্কতার জন্য কোনো প্রমাণ আপলোড করা হয়নি।',
  'Dispatched Responders': 'প্রেরিত সাড়াদানকারী',
};

export function useT() {
  const lang = useLangStore((s) => s.lang);
  return (s: string): string => (lang === 'bn' ? translations[s] ?? s : s);
}
