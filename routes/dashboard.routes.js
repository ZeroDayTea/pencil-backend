const express = require('express');
const dashboardController = require('../controllers/dashboard.controller.js');
const authController = require('../controllers/auth.controller.js');

const router = express.Router();

router.use(authController.requireLogin);

router
  .route('/stats').get(
    dashboardController.getDashboardSchedules,
    dashboardController.getDashboardTransactions,
    dashboardController.getAllStats
  );

router
  .route('/dailystats')
  .get(
    dashboardController.getDashboardSchedules,
    dashboardController.getDashboardTransactions,
    dashboardController.getDailyMonthlyStats
  );

router
  .route('/monthlystats')
  .get(
    dashboardController.getDashboardSchedules,
    dashboardController.getDashboardTransactions,
    dashboardController.getDailyMonthlyStats
  );

router
  .route('/yearlystats')
  .get(
    dashboardController.getDashboardSchedules,
    dashboardController.getDashboardTransactions,
    dashboardController.getYearlyStats
  );

module.exports = router;
