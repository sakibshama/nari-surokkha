/**
 * Lightweight i18n for the Admin Portal.
 *
 * Keyed by the English source string, so any untranslated text falls back to
 * English automatically — the UI never breaks on a missing key. Use the
 * `useT()` hook to get a translator: `const t = useT(); t('Dashboard')`.
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

/** English source → Bengali. */
export const translations: Record<string, string> = {
  // ── Navigation & sections ──
  'Main': 'প্রধান',
  'System': 'সিস্টেম',
  'Dashboard': 'ড্যাশবোর্ড',
  'Users': 'ব্যবহারকারী',
  'User Management': 'ব্যবহারকারী ব্যবস্থাপনা',
  'Role Management': 'ভূমিকা ব্যবস্থাপনা',
  'Responders': 'সাড়াদানকারী',
  'Police Stations': 'থানা',
  'Incident Reports': 'ঘটনার প্রতিবেদন',
  'Analytics': 'বিশ্লেষণ',
  'City Safety Analytics': 'নগর নিরাপত্তা বিশ্লেষণ',
  'Audit Logs': 'অডিট লগ',
  'ML Tuning': 'এমএল টিউনিং',
  'ML Tuning Configuration': 'এমএল টিউনিং কনফিগারেশন',
  'ML Models': 'এমএল মডেল',
  'On-Device ML Models': 'ডিভাইস-ভিত্তিক এমএল মডেল',
  'Settings': 'সেটিংস',
  'Admin Portal': 'অ্যাডমিন পোর্টাল',

  // ── Top bar ──
  'Alerts': 'সতর্কতা',
  'Logout': 'লগ আউট',
  'Active Alerts': 'সক্রিয় সতর্কতা',
  'View All Alerts': 'সব সতর্কতা দেখুন',
  'No active alerts right now.': 'এই মুহূর্তে কোনো সক্রিয় সতর্কতা নেই।',
  'New': 'নতুন',
  'SOS Emergency': 'এসওএস জরুরি',
  'Toggle theme': 'থিম পরিবর্তন',
  'Language': 'ভাষা',

  // ── Identity / government ──
  'Government of Bangladesh': 'বাংলাদেশ সরকার',
  "Government of the People's Republic of Bangladesh": 'গণপ্রজাতন্ত্রী বাংলাদেশ সরকার',
  'National Women Safety Service': 'জাতীয় নারী নিরাপত্তা সেবা',
  'Administrator': 'প্রশাসক',
  'Admin': 'অ্যাডমিন',

  // ── Dashboard ──
  'Command Overview': 'কমান্ড ওভারভিউ',
  'Real-time emergency response & safety monitoring across the nation':
    'সারাদেশে রিয়েল-টাইম জরুরি সাড়া ও নিরাপত্তা পর্যবেক্ষণ',
  'Live Feed': 'লাইভ ফিড',
  'Reconnecting…': 'পুনঃসংযোগ হচ্ছে…',
  'Refresh': 'রিফ্রেশ',
  'Active Emergencies': 'সক্রিয় জরুরি অবস্থা',
  'Registered Users': 'নিবন্ধিত ব্যবহারকারী',
  'Verified Responders': 'যাচাইকৃত সাড়াদানকারী',
  'Pending Reviews': 'অপেক্ষমাণ পর্যালোচনা',
  'Avg Safety Score': 'গড় নিরাপত্তা স্কোর',
  'Global Active Alerts': 'বৈশ্বিক সক্রিয় সতর্কতা',
  'LIVE TRACKING': 'লাইভ ট্র্যাকিং',
  'Live': 'লাইভ',
  'Last updated': 'সর্বশেষ হালনাগাদ',
  'Auto-refreshes on new events': 'নতুন ঘটনায় স্বয়ংক্রিয়ভাবে হালনাগাদ হয়',
  'NEW': 'নতুন',
  'CONFIRMED': 'নিশ্চিত',
  'RESPONDING': 'সাড়া দিচ্ছে',
  'RESOLVED': 'সমাধান হয়েছে',
  'DISMISSED': 'খারিজ',
  'critical': 'জরুরি',
  'responding': 'সাড়া দিচ্ছে',
  'Loading emergency data…': 'জরুরি তথ্য লোড হচ্ছে…',
  'All Clear — No Active Emergencies': 'সব নিরাপদ — কোনো সক্রিয় জরুরি অবস্থা নেই',
  "The platform is monitoring in real-time. You'll be notified instantly when a new SOS is triggered.":
    'প্ল্যাটফর্মটি রিয়েল-টাইমে পর্যবেক্ষণ করছে। নতুন এসওএস চালু হলে আপনাকে তাৎক্ষণিকভাবে জানানো হবে।',
  'Platform Online': 'প্ল্যাটফর্ম অনলাইন',
  'WebSocket Live': 'ওয়েবসকেট লাইভ',
  'GPS Tracking Ready': 'জিপিএস ট্র্যাকিং প্রস্তুত',
  'Track Live': 'লাইভ ট্র্যাক',
  'Critical': 'সংকটজনক',
  'Unknown Victim': 'অজ্ঞাত ভুক্তভোগী',
  'SOFT ALERT': 'সফট সতর্কতা',
  'Violence': 'সহিংসতা',
  'Fire': 'অগ্নিকাণ্ড',
  'Accident': 'দুর্ঘটনা',
  'Medical': 'চিকিৎসা',
  'Alert': 'সতর্কতা',

  // ── Login ──
  'Sign In': 'সাইন ইন',
  'Authenticating…': 'যাচাই করা হচ্ছে…',
  'Phone Number': 'ফোন নম্বর',
  'Password': 'পাসওয়ার্ড',
  'National Women Safety Service — Admin Portal': 'জাতীয় নারী নিরাপত্তা সেবা — অ্যাডমিন পোর্টাল',
  'This system is monitored. Unauthorized access is prohibited.':
    'এই সিস্টেমটি পর্যবেক্ষণ করা হয়। অননুমোদিত প্রবেশ নিষিদ্ধ।',
  'Access denied. This portal is for administrators only.':
    'প্রবেশ প্রত্যাখ্যাত। এই পোর্টালটি শুধুমাত্র প্রশাসকদের জন্য।',
  'Login failed. Please check your credentials.':
    'লগইন ব্যর্থ। অনুগ্রহ করে আপনার তথ্য যাচাই করুন।',

  // ── Common actions & labels ──
  'Search': 'অনুসন্ধান',
  'Search…': 'অনুসন্ধান…',
  'Save': 'সংরক্ষণ',
  'Save Changes': 'পরিবর্তন সংরক্ষণ',
  'Cancel': 'বাতিল',
  'Delete': 'মুছুন',
  'Edit': 'সম্পাদনা',
  'Add': 'যোগ করুন',
  'Create': 'তৈরি করুন',
  'Update': 'হালনাগাদ',
  'Close': 'বন্ধ',
  'Confirm': 'নিশ্চিত করুন',
  'View': 'দেখুন',
  'View Details': 'বিস্তারিত দেখুন',
  'Back': 'ফিরে যান',
  'Loading…': 'লোড হচ্ছে…',
  'No data': 'কোনো তথ্য নেই',
  'No results found': 'কোনো ফলাফল পাওয়া যায়নি',
  'Name': 'নাম',
  'Full Name': 'পূর্ণ নাম',
  'Phone': 'ফোন',
  'Email': 'ইমেইল',
  'Role': 'ভূমিকা',
  'Status': 'অবস্থা',
  'Actions': 'কার্যক্রম',
  'Created': 'তৈরি হয়েছে',
  'Created At': 'তৈরির সময়',
  'Updated': 'হালনাগাদ হয়েছে',
  'Type': 'ধরন',
  'Location': 'অবস্থান',
  'Time': 'সময়',
  'Date': 'তারিখ',
  'Active': 'সক্রিয়',
  'Inactive': 'নিষ্ক্রিয',
  'Verified': 'যাচাইকৃত',
  'Pending': 'অপেক্ষমাণ',
  'Approved': 'অনুমোদিত',
  'Rejected': 'প্রত্যাখ্যাত',
  'Resolved': 'সমাধান হয়েছে',
  'Dismissed': 'খারিজ',
  'Verify': 'যাচাই করুন',
  'Approve': 'অনুমোদন',
  'Reject': 'প্রত্যাখ্যান',
  'Enabled': 'সক্রিয়',
  'Disabled': 'নিষ্ক্রিয',
  'Yes': 'হ্যাঁ',
  'No': 'না',
  'All': 'সব',
  'Total': 'মোট',

  // ── Page subtitles / misc ──
  'Real-time metrics for the Nari Surokkha platform':
    'নারী সুরক্ষা প্ল্যাটফর্মের রিয়েল-টাইম পরিসংখ্যান',
  'Manage platform users and their roles': 'প্ল্যাটফর্মের ব্যবহারকারী ও তাদের ভূমিকা পরিচালনা করুন',
  'Manage responder verifications': 'সাড়াদানকারীদের যাচাই পরিচালনা করুন',
  'Manage police stations': 'থানা পরিচালনা করুন',
  'Review submitted incident reports': 'জমাকৃত ঘটনার প্রতিবেদন পর্যালোচনা করুন',
  'System audit trail': 'সিস্টেম অডিট ট্রেইল',

  // ── Users page ──
  'Manage platform users, assign roles, and control RBAC permissions.':
    'প্ল্যাটফর্মের ব্যবহারকারী পরিচালনা করুন, ভূমিকা বরাদ্দ করুন, এবং RBAC অনুমতি নিয়ন্ত্রণ করুন।',
  'Add User': 'ব্যবহারকারী যোগ করুন',
  'Total Users': 'মোট ব্যবহারকারী',
  'Admins': 'প্রশাসকগণ',
  'User': 'ব্যবহারকারী',
  'Joined': 'যোগদান',
  'Loading users…': 'ব্যবহারকারী লোড হচ্ছে…',
  'No users found': 'কোনো ব্যবহারকারী পাওয়া যায়নি',
  'Try adjusting the search or filters.': 'অনুসন্ধান বা ফিল্টার সমন্বয় করে দেখুন।',
  'Refresh Data': 'তথ্য রিফ্রেশ',
  'Failed to load data.': 'তথ্য লোড করতে ব্যর্থ।',
  'National ID': 'জাতীয় পরিচয়পত্র',
  'Badge Number': 'ব্যাজ নম্বর',
  'Station Assignment': 'থানা নিয়োগ',
  'None': 'কোনোটিই নয়',
  'Permissions': 'অনুমতি',

  // ── Responders page ──
  'Responders Management': 'সাড়াদানকারী ব্যবস্থাপনা',
  'Verify and manage community responders.': 'কমিউনিটি সাড়াদানকারীদের যাচাই ও পরিচালনা করুন।',
  'Responder Info': 'সাড়াদানকারীর তথ্য',
  'Organization': 'সংস্থা',
  'No responders found matching your criteria.': 'আপনার শর্ত অনুযায়ী কোনো সাড়াদানকারী পাওয়া যায়নি।',

  // ── Roles page ──
  'Description': 'বিবরণ',
  'No Role Selected': 'কোনো ভূমিকা নির্বাচিত নয়',
  'Select a role from the sidebar to view details and manage it.':
    'বিস্তারিত দেখতে ও পরিচালনা করতে সাইডবার থেকে একটি ভূমিকা নির্বাচন করুন।',
  'Role Name': 'ভূমিকার নাম',
  'Role Key': 'ভূমিকা কী',

  // ── Police Stations page ──
  'Manage platform police stations.': 'প্ল্যাটফর্মের থানা পরিচালনা করুন।',
  'Add Station': 'থানা যোগ করুন',
  'Station Name / Code': 'থানার নাম / কোড',
  'Contact': 'যোগাযোগ',
  'No police stations found.': 'কোনো থানা পাওয়া যায়নি।',
  'Station Name': 'থানার নাম',
  'Thana Code': 'থানা কোড',
  'Division': 'বিভাগ',
  'District': 'জেলা',
  'Address': 'ঠিকানা',

  // ── Incidents page ──
  'Loading incident reports…': 'ঘটনার প্রতিবেদন লোড হচ্ছে…',

  // ── Settings page ──
  'Manage your account preferences and security.': 'আপনার অ্যাকাউন্টের পছন্দ ও নিরাপত্তা পরিচালনা করুন।',
  'Profile Information': 'প্রোফাইল তথ্য',
  'Phone Number (Read-only)': 'ফোন নম্বর (শুধু পঠনযোগ্য)',
  'Email Address': 'ইমেইল ঠিকানা',
  'Display Preferences': 'প্রদর্শন পছন্দ',
  'Theme Mode': 'থিম মোড',
  'Toggle between light and dark mode': 'লাইট ও ডার্ক মোডের মধ্যে পরিবর্তন করুন',
  'Security': 'নিরাপত্তা',
  'Current Password': 'বর্তমান পাসওয়ার্ড',
  'New Password': 'নতুন পাসওয়ার্ড',
  'Confirm New Password': 'নতুন পাসওয়ার্ড নিশ্চিত করুন',
  'Change Password': 'পাসওয়ার্ড পরিবর্তন',
  'Save Profile': 'প্রোফাইল সংরক্ষণ',

  // ── Analytics page ──
  'Loading analytics data...': 'বিশ্লেষণ তথ্য লোড হচ্ছে...',

  // ── Audit Logs page ──
  'System Audit Logs': 'সিস্টেম অডিট লগ',
  'Immutable record of system actions. Sensitive data is automatically masked.':
    'সিস্টেম কার্যক্রমের অপরিবর্তনীয় রেকর্ড। সংবেদনশীল তথ্য স্বয়ংক্রিয়ভাবে গোপন করা হয়।',
  'Timestamp': 'সময়চিহ্ন',
  'Action': 'কার্যক্রম',
  'Entity Type': 'সত্তার ধরন',
  'IP Address': 'আইপি ঠিকানা',
  'Metadata': 'মেটাডেটা',
  'No audit logs found.': 'কোনো অডিট লগ পাওয়া যায়নি।',

  // ── ML Tuning / Models ──
  'Adjust the sensitivity thresholds for the machine learning services.':
    'মেশিন লার্নিং সেবার সংবেদনশীলতার সীমা সমন্বয় করুন।',
  'Fall Detection Sensitivity': 'পতন শনাক্তকরণ সংবেদনশীলতা',
  'Minimum confidence threshold to trigger a soft alert for a fall.':
    'পতনের জন্য সফট সতর্কতা চালু করার ন্যূনতম আস্থার সীমা।',
  'Audio Distress Confidence': 'অডিও দুর্দশা আস্থা',
  'Minimum confidence threshold to trigger a soft alert for distress audio.':
    'দুর্দশার অডিওর জন্য সফট সতর্কতা চালু করার ন্যূনতম আস্থার সীমা।',
  'Model Registry (motion)': 'মডেল রেজিস্ট্রি (গতি)',
  'Alert Details': 'সতর্কতার বিবরণ',
  'Alert not found.': 'সতর্কতা পাওয়া যায়নি।',
  'Alert Information': 'সতর্কতার তথ্য',
  'Live Location Map': 'লাইভ অবস্থান মানচিত্র',
  'Live SOS Evidence': 'লাইভ এসওএস প্রমাণ',
  'No evidence has been uploaded for this alert yet.': 'এই সতর্কতার জন্য এখনও কোনো প্রমাণ আপলোড করা হয়নি।',
  'Receiving Silent Audio Stream...': 'নীরব অডিও স্ট্রিম গ্রহণ করা হচ্ছে...',
  'Upload a trained model': 'একটি প্রশিক্ষিত মডেল আপলোড করুন',
  'Collected Training Data': 'সংগৃহীত প্রশিক্ষণ তথ্য',
  'None yet.': 'এখনও কিছু নেই।',
};

/** Returns a translator bound to the current language. */
export function useT() {
  const lang = useLangStore((s) => s.lang);
  return (s: string): string => (lang === 'bn' ? translations[s] ?? s : s);
}
