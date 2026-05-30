 Only the content.

---

**[Tutorial] Designing Public vs. Private State: What Goes Where and Why**  

### 1. **Exported vs Non-Exported Ledger Fields**  

The foundation of any public ledger is the data that users can access without intermediaries. However, **public state** must be *transparent* to all participants, meaning all ledger fields must be visible in the public scope. In contrast, **private state** is intended for **only** specific users or systems, requiring the data to remain **hidden** behind a secret vault.  

**Example:**  
- If a user wants to show their current balance, they must use a non-exported ledger field (`balance`) that is only accessible to their own system.  
- If they want to share their token ownership with the public, they must use an **exported** ledger field (`token_id`) to ensure the data is publicly accessible.  

### 2. **Implications of `disclose()`**  

Every time a user calls `disclose()`, they are essentially asking the system to reveal a piece of data to the public. This action has two primary consequences:  

1. **Public visibility** is created, but it comes at the cost of **privacy**. If a token is disclosed, it is exposed to any observer, including those who might be trying to steal or manipulate it.  
2. **Data integrity** is compromised, as any disclosure could lead to **un