import { authRequired } from '../middleware.js';
import { attachBranch, requireAdmin } from '../middleware.js';
import { saveStaffLocation, listStaffLocations, listStaffLocationHistory } from '../staffLocation.js';

export function registerStaffRoutes(app) {
  app.post('/api/staff/location', authRequired, attachBranch, (req, res) => {
    try {
      const location = saveStaffLocation(req.user.id, req.branchId, {
        ...req.body,
        source: req.body?.source || 'pwa',
      });
      res.json(location);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/admin/staff-locations', requireAdmin, (req, res) => {
    res.json(listStaffLocations(req.query));
  });

  app.get('/api/admin/staff-locations/history', requireAdmin, (req, res) => {
    try {
      res.json(listStaffLocationHistory(req.query));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
