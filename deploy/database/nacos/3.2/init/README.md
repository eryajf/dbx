# Nacos 3.2 initialization

The `initialize` Compose service sets the first-run password of the `nacos` administrator to `123456` (or `DB_PASSWORD`) through the Nacos authentication API. On later starts it verifies those credentials without overwriting the account, then remains running so Docker Compose can wait for the complete environment. The named data volume preserves the initialized account.
