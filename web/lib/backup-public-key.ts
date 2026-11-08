/**
 * Public half of the backup key (RSA-4096). Backups are encrypted with it; only the private half,
 * kept offline by the owner of Quioco, can open them. Being public, it is safe in the repository.
 * To rotate: make a new pair, replace this text, publish, and keep the old private key for old backups.
 */
export const BACKUP_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAhNn1e/GtIn9OoyN0LSlg
I15bZo50+dlFT8okIeFTq80esH05SiOLyILyBT64gwe+7cd6C249KdpZGwSSQmd2
VcZHuwifTRYf5d4UA7jyxTBu2xaCSNdgDRYoV+uTe2NuGfnN9rWCRUkLW5NrzzBi
PN7gY268n3d2CjRpfNjI/bRAxpH0ZMUfS65DyYa0qwNvlxrDz4wS1cR6U96O4GE9
8S0kTjhVg4kIHZ6BPGq123kPlQHpY8gRcqX0YZajtZiaD8NpeIEGM83nsyF0481M
U+eTlRRZEfpwe5OeUChNE/vlzbiLrerB29DuTEzAVnqmF/dMVet7W5Tl1sTY9Ul8
tK9P9XWi5Jr8rRyn1bMDIl6M9eisE01bEFfBHgYYr1KVQxQnnKJ45Euc7rRqRydG
tmpDRDMEsO9sPDlExBpOKu2HgtQ0iKuzv4EZx8ExeIQSOEJs8FomVhkimO2CaZXy
jhRu0wN9+K4WXk60C7i+X5fjLMivch3yxvmvVdDA/7m5d11+1BugLGvdyRYBgl6U
i/SgkpYqtwxZjvMQN5UcCaIeM9SOcSygUqEUpgUgkWtGoOlFHxQ2OSaErZOnZAjg
etLWuwIXdwk76y5F34oKZXBzxhcFxDav5vixl/90G42xcAniQg3yeDHVgd2WcfJe
jQmZqAlCdeGCy8C82KG1vh8CAwEAAQ==
-----END PUBLIC KEY-----`;
