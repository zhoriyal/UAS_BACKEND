const express = require('express');
const aiControllerModule = require('../controllers/aiController');
const generateDescription = aiControllerModule.generateDescription
  || aiControllerModule.default?.generateDescription
  || aiControllerModule.default;
const artifactMatchControllerModule = require('../controllers/artifactMatchController');
const createArtifactMatch = artifactMatchControllerModule.createArtifactMatch
  || artifactMatchControllerModule.default?.createArtifactMatch
  || artifactMatchControllerModule.default;
const getArtifactMatches = artifactMatchControllerModule.getArtifactMatches
  || artifactMatchControllerModule.default?.getArtifactMatches
  || artifactMatchControllerModule.default;
const authMiddlewareModule = require('../middleware/authMiddleware');
const authMiddleware = authMiddlewareModule.default || authMiddlewareModule;
const requireRoleModule = require('../middleware/requireRole');
const requireRole = requireRoleModule.requireRole || requireRoleModule.default || requireRoleModule;
const rateLimiterModule = require('../middleware/rateLimiter');
const rateLimiter = rateLimiterModule.default || rateLimiterModule;

const router = express.Router();
const artifactMatchRateLimit = rateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: 'Terlalu banyak permintaan kuis. Silakan coba lagi nanti.',
});

router.post('/artifact-match', artifactMatchRateLimit, createArtifactMatch);
router.get('/artifact-matches', authMiddleware, requireRole(['ADMIN', 'SUPERADMIN', 'STAFF']), getArtifactMatches);
router.post(
  '/generate-description',
  authMiddleware,
  requireRole(['ADMIN', 'SUPERADMIN', 'STAFF']),
  generateDescription,
);

module.exports = router;
