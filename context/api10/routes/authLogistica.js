const express = require("express");
const { requireLogisticaFirebaseAuth } = require("../auth/requireLogisticaFirebaseAuth");

const { requireLogisticaAuthorizedUser } = require("../auth/requireLogisticaAuthorizedUser");

const router = express.Router();

router.get("/me", requireLogisticaFirebaseAuth, (req, res) => {
  const { uid, email, firebaseProject } = req.auth;
  res.json({ authenticated: true, uid, email, firebaseProject });
});

// Solo LOCAL/TEST (el router se monta unicamente en esos entornos).
router.get(
  "/authorized-me",
  requireLogisticaFirebaseAuth,
  requireLogisticaAuthorizedUser,
  (req, res) => {
    res.json({
      authenticated: true,
      authorized: true,
      email: req.logisticaUser.email || req.auth.email,
      firebaseProject: req.auth.firebaseProject,
    });
  }
);

module.exports = router;
