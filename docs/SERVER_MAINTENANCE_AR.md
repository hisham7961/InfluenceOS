# صيانة السيرفر — مساحة القرص

القرص الممتلئ يوقف قاعدة البيانات. ثلاث أشياء تملأه مع الوقت: صور Docker
القديمة (كل تحديث يسحب صوراً جديدة)، سجلات الحاويات، والنسخ الاحتياطية المحلية.

## 1) إعداد لمرة وحدة: تحديد حجم سجلات Docker

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "log-driver": "local",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}
JSON
sudo systemctl restart docker
cd /opt/influenceos && docker compose up -d   # حتى تأخذ الحاويات الإعداد الجديد
```

> إذا كان الملف `/etc/docker/daemon.json` موجوداً وفيه إعدادات ثانية، أضف
> المفتاحين بدل استبدال الملف.

## 2) تنظيف أسبوعي تلقائي

```bash
crontab -e
# كل يوم أحد الساعة 4 الفجر:
0 4 * * 0  cd /opt/influenceos && scripts/server-maintenance.sh >> /var/log/influenceos-maintenance.log 2>&1
```

السكربت يحذف فقط صور Docker غير المستخدمة والأقدم من أسبوع، ولا يلمس قاعدة
البيانات ولا الملفات المرفوعة ولا الحاويات الشغّالة.

## 3) المراقبة من داخل البرنامج

**الإعدادات ← المنصة ← حالة المكوّنات ← Disk** تعرض نسبة الامتلاء والمساحة
الفارغة: أصفر عند 85% وأحمر عند 95%.

## 4) النسخ الاحتياطية المحلية

تُحفظ في `/var/backups/influenceos` (أو `BACKUP_DIR`). إذا كان القرص صغيراً،
فعّل النسخة خارج السيرفر (انظر `docs/BACKUPS_AR.md`) وقلّل
`BACKUP_RETENTION_DAILY`.
