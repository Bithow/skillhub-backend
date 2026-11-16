const prisma = require('../utils/prisma');

const recordSiteVisit = async (req, res) => {
    const visitorKey = String(req.body.visitorKey || '').trim();
    const path = String(req.body.path || '').trim();
    const deviceType = String(req.body.deviceType || '').trim();
    const referrer = String(req.body.referrer || '').trim();
    if (!/^[a-zA-Z0-9_-]{12,80}$/.test(visitorKey)
        || !path.startsWith('/') || path.length > 300 || path.startsWith('//')
        || !['mobile', 'tablet', 'desktop', 'unknown'].includes(deviceType)
        || referrer.length > 120 || /[/?#]/.test(referrer)) {
        return res.status(400).json({ success: false, message: 'Invalid site visit record' });
    }
    if (path === '/admin.html' || path.startsWith('/admin/')) {
        return res.status(204).end();
    }
    try {
        await prisma.siteVisit.create({ data: { visitorKey, path, deviceType, referrer: referrer || null } });
        res.status(202).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Could not record site visit' });
    }
};

const getSiteVisitAnalytics = async (req, res) => {
    const days = Math.min(90, Math.max(1, Number.parseInt(req.query.days, 10) || 30));
    const since = new Date();
    since.setDate(since.getDate() - days);
    try {
        const [total, uniqueVisitors, records, recent] = await Promise.all([
            prisma.siteVisit.count({ where: { createdAt: { gte: since } } }),
            prisma.siteVisit.groupBy({ by: ['visitorKey'], where: { createdAt: { gte: since } } }),
            prisma.siteVisit.findMany({
                where: { createdAt: { gte: since } },
                orderBy: { createdAt: 'desc' },
                take: 5000,
                select: { visitorKey: true, path: true, deviceType: true, referrer: true, createdAt: true }
            }),
            prisma.siteVisit.findMany({
                orderBy: { createdAt: 'desc' },
                take: 100,
                select: { visitorKey: true, path: true, deviceType: true, referrer: true, createdAt: true }
            })
        ]);
        const byDay = new Map();
        const byPath = new Map();
        const byDevice = new Map();
        for (const visit of records) {
            const day = visit.createdAt.toISOString().slice(0, 10);
            byDay.set(day, (byDay.get(day) || 0) + 1);
            byPath.set(visit.path, (byPath.get(visit.path) || 0) + 1);
            byDevice.set(visit.deviceType, (byDevice.get(visit.deviceType) || 0) + 1);
        }
        res.json({
            success: true,
            rangeDays: days,
            totals: { pageViews: total, uniqueSessions: uniqueVisitors.length },
            daily: Array.from(byDay, ([date, pageViews]) => ({ date, pageViews })).sort((a, b) => a.date.localeCompare(b.date)),
            topPages: Array.from(byPath, ([path, pageViews]) => ({ path, pageViews })).sort((a, b) => b.pageViews - a.pageViews).slice(0, 10),
            devices: Array.from(byDevice, ([deviceType, pageViews]) => ({ deviceType, pageViews })).sort((a, b) => b.pageViews - a.pageViews),
            recent: recent.map(visit => ({ ...visit, visitorKey: `${visit.visitorKey.slice(0, 8)}...` }))
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { recordSiteVisit, getSiteVisitAnalytics };