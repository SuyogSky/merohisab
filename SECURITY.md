# Security Policy for MeroHisab

The security and privacy of user financial records are foundational to **MeroHisab (मेरो हिसाब)**. This policy outlines how security is handled and how to report vulnerabilities responsibly.

---

## 1. Architecture & Privacy Model

MeroHisab is designed as a **local-first, 100% client-side web application**:

- **No Remote Servers**: MeroHisab does not transmit financial records, account numbers, amounts, or personal notes to any backend server, cloud database, or third-party analytics service.
- **Local Browser Sandbox**: All financial data is persisted locally in the user's web browser using IndexedDB and LocalStorage APIs.
- **No Third-Party Trackers**: The codebase contains zero external tracking scripts, advertising SDKs, or telemetry.
- **Client-Side Data Portability**: Backups are created as plain JSON or CSV files downloaded directly to the user's local disk via browser Blob APIs.

Because data remains on the user's device, the primary threat model centers on browser environment integrity, local machine physical/browser access, and defending against Cross-Site Scripting (XSS) within the client runtime.

---

## 2. Reporting Security Vulnerabilities

If you discover a security vulnerability or weakness in MeroHisab, please report it **responsibly and privately**.

### How to Report

Security vulnerabilities should be reported privately using **GitHub Private Vulnerability Reporting**:

1. Once this repository is published, the repository owner must enable **Private vulnerability reporting** in repository settings (**Settings > Code security and analysis > Private vulnerability reporting**).
2. To submit a report, navigate to the **Security** tab of the GitHub repository, click **"Advisories"**, and select **"Report a vulnerability"** to submit a confidential report directly to the repository maintainer.

Please do not disclose security issues in public GitHub issues, discussions, or pull requests until a fix is released.

### What to Include

Please provide:
- A clear description of the vulnerability and its potential impact.
- Step-by-step instructions or proof-of-concept steps to reproduce the issue.
- The browser and operating system versions where the behavior was observed.
- Any suggested remediations or mitigations, if known.

### Public Disclosure Guidelines

To protect users:
- Please **do not** open public GitHub issues or disclose technical exploit details in public forums until a fix has been developed, tested, and released.
- The project maintainer will review reports promptly, coordinate validation, and publish a fix.

---

## 3. Important Notice on Sharing Financial Backups

When reporting normal bugs or submitting issues:
- **Never post real financial backups, real transaction exports, or actual bank balances** in public GitHub issues, discussions, or pull requests.
- Always use sanitized, fictional demo data or anonymized sample files when illustrating bug reports or edge cases.

---

## 4. Scope and Disclaimers

MeroHisab is an open-source, client-side personal finance utility provided under standard open-source terms without commercial warranty. It has not undergone formal corporate penetration testing or government security certification. Users are encouraged to protect their physical devices and maintain encrypted external backups of their financial exports.
