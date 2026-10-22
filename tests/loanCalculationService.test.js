const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getApplicableInterestRate,
  calculateMonthlyInterestProvision,
  distributeRepayment,
  isInterestProvisionApplicable,
  getMonthEndDate
} = require('../services/loanCalculationService');

test('uses 8 percent through December 2019 and 7 percent from January 2020', () => {
  assert.equal(getApplicableInterestRate('2019-12'), 8);
  assert.equal(getApplicableInterestRate('2020-01'), 7);
  assert.equal(getApplicableInterestRate('2026-10'), 7);
});

test('calculates simple monthly interest and rounds to whole taka', () => {
  assert.equal(calculateMonthlyInterestProvision(120000, 12), 1200);
  assert.equal(calculateMonthlyInterestProvision(100000, 7), 583);
  assert.equal(calculateMonthlyInterestProvision(0, 7), 0);
});

test('does not provision interest for loans from another PBS', () => {
  assert.equal(isInterestProvisionApplicable('OWN_PBS'), true);
  assert.equal(isInterestProvisionApplicable('OTHER_PBS'), false);
});

test('repayment pays principal first, then interest, and keeps excess as advance', () => {
  assert.deepEqual(distributeRepayment(1500, 1000, 300), {
    principalPaid: 1000,
    interestPaid: 300,
    newPrincipalBalance: 0,
    newInterestBalance: 0,
    appliedAmount: 1300,
    unappliedAmount: 200
  });
});

test('repayment cannot drive principal or interest below zero', () => {
  assert.deepEqual(distributeRepayment(800, 1000, 400), {
    principalPaid: 800,
    interestPaid: 0,
    newPrincipalBalance: 200,
    newInterestBalance: 400,
    appliedAmount: 800,
    unappliedAmount: 0
  });
  assert.deepEqual(distributeRepayment(650, 0, 400), {
    principalPaid: 0,
    interestPaid: 400,
    newPrincipalBalance: 0,
    newInterestBalance: 0,
    appliedAmount: 400,
    unappliedAmount: 250
  });
});

test('returns the correct last date for a provision month', () => {
  assert.equal(getMonthEndDate('2024-02'), '2024-02-29');
  assert.equal(getMonthEndDate('2026-02'), '2026-02-28');
});
