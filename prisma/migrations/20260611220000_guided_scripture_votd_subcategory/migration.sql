-- Assign subcategories to existing guided-scripture MessageVariant rows.
-- Previously all guided-scripture variants had subcategory = NULL.
-- Dynamic VOTD variants (names starting with "VOTD:") get 'votd-dynamic';
-- the remaining static variants get 'guided-scripture'.

UPDATE "MessageVariant"
SET subcategory = 'votd-dynamic'
WHERE category = 'guided-scripture'
  AND subcategory IS NULL
  AND name LIKE 'VOTD:%';

UPDATE "MessageVariant"
SET subcategory = 'guided-scripture'
WHERE category = 'guided-scripture'
  AND subcategory IS NULL;
