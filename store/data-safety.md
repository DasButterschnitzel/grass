# Play Console – Data safety answers (Zen Mower)

These answers reflect the app as built: no own backend, progress stored locally, Google Mobile Ads SDK (AdMob) + User Messaging Platform. Re-check Google's current SDK guidance before submitting: <https://developers.google.com/admob/android/privacy/play-data-disclosure>

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** (via the Google Mobile Ads SDK) |
| Is all user data encrypted in transit? | **Yes** |
| Do you provide a way for users to request that their data is deleted? | No account data exists; ad data → Google. Answer **No** (or point to the privacy policy). |

**Data types (collected and shared by the AdMob SDK):**

| Data type | Collected | Shared | Purpose | Optional? |
| --- | --- | --- | --- | --- |
| Location → Approximate location (IP-derived) | Yes | Yes | Advertising or marketing, Analytics, Fraud prevention | Not optional |
| App activity → App interactions | Yes | Yes | Advertising or marketing, Analytics | Not optional |
| App info and performance → Crash logs, Diagnostics | Yes | Yes | Analytics, Fraud prevention | Not optional |
| Device or other IDs → Device or other IDs (advertising ID, app set ID) | Yes | Yes | Advertising or marketing, Analytics, Fraud prevention | Not optional |

Other settings:
* **Ads**: Contains ads – Yes.
* **Advertising ID declaration**: Yes, the app uses the advertising ID (AdMob). Purpose: Advertising or marketing, Analytics.
* **Target audience**: 13+ / not primarily child-directed.
