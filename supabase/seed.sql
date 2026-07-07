-- SideEye · seed.sql — AU category taxonomy
-- Parents first, then children reference by name lookup.

insert into categories (name, emoji, is_income, is_tax_relevant, sort) values
  -- Income
  ('Salary & Wages',        '💰', true,  false, 1),
  ('Interest & Dividends',  '📈', true,  true,  2),
  ('Other Income',          '🪙', true,  false, 3),
  -- Essentials
  ('Groceries',             '🛒', false, false, 10),
  ('Rent & Mortgage',       '🏠', false, false, 11),
  ('Utilities',             '💡', false, false, 12),  -- power, gas, water
  ('Phone & Internet',      '📱', false, true,  13),  -- partial WFH deduction
  ('Insurance',             '🛡️', false, false, 14),
  ('Health & Medical',      '🩺', false, false, 15),
  ('Rates & Strata',        '🏛️', false, false, 16),
  -- Transport
  ('Fuel',                  '⛽', false, true,  20),  -- deductible if work travel
  ('Car — Rego & Service',  '🚗', false, true,  21),
  ('Public Transport',      '🚌', false, true,  22),
  ('Tolls & Parking',       '🅿️', false, true,  23),
  -- Lifestyle
  ('Eating Out & Takeaway', '🍔', false, false, 30),
  ('Coffee',                '☕', false, false, 31),  -- its own category. The Quokka insisted.
  ('Entertainment',         '🎬', false, false, 32),
  ('Subscriptions',         '🔁', false, false, 33),
  ('Shopping & Clothing',   '🛍️', false, false, 34),
  ('Travel & Holidays',     '✈️', false, false, 35),
  ('Gifts & Donations',     '🎁', false, true,  36),  -- DGR donations deductible
  ('Alcohol & Vices',       '🍺', false, false, 37),
  ('Home & Garden',         '🛠️', false, false, 38),
  ('Pets',                  '🐕', false, false, 39),
  -- Money movement
  ('Transfers',             '↔️', false, false, 50),  -- excluded from spend totals
  ('Savings Contribution',  '🏦', false, false, 51),
  ('Super Contribution',    '🦺', false, true,  52),  -- personal concessional = deductible
  ('Investments',           '📊', false, true,  53),
  ('Loan Repayment',        '💳', false, false, 54),
  -- Work / tax
  ('Work Expenses',         '💼', false, true,  60),  -- tools, equipment, uniform
  ('Self-Education',        '📚', false, true,  61),
  ('Working From Home',     '🏡', false, true,  62),
  ('Tax & Accounting Fees', '🧾', false, true,  63),
  -- Fallbacks
  ('Bank Fees',             '🏧', false, false, 70),
  ('Uncategorised',         '❓', false, false, 99);
