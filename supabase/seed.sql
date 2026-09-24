-- Reference data. Schemes and service guides live in data/ and are loaded by
-- scripts/sync_corpus.py (so there is one source of truth for content).

insert into janseva.wards (id, name, lat, lng) values
  ('hazratganj', 'Hazratganj', 26.8506, 80.9462),
  ('aminabad', 'Aminabad', 26.8435, 80.9310),
  ('chowk', 'Chowk', 26.8687, 80.9110),
  ('aliganj', 'Aliganj', 26.8960, 80.9420),
  ('gomti-nagar', 'Gomti Nagar', 26.8565, 81.0060),
  ('indira-nagar', 'Indira Nagar', 26.8800, 80.9960),
  ('alambagh', 'Alambagh', 26.8150, 80.9020),
  ('rajajipuram', 'Rajajipuram', 26.8420, 80.8800)
on conflict (id) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng;

insert into janseva.departments (id, name, name_hi, categories, sla_hours) values
  ('lmc-swm', 'Nagar Nigam — Solid Waste Management', 'नगर निगम — ठोस अपशिष्ट प्रबंधन', '{waste}', 48),
  ('jalkal', 'Jal Kal Vibhag', 'जलकल विभाग', '{water_drainage}', 72),
  ('lmc-civil', 'Nagar Nigam — Civil Works (Roads)', 'नगर निगम — सिविल (सड़क)', '{roads}', 168),
  ('lmc-lighting', 'Nagar Nigam — Street Lighting', 'नगर निगम — मार्ग प्रकाश', '{streetlights}', 72),
  ('lmc-infra', 'Nagar Nigam — Public Infrastructure', 'नगर निगम — सार्वजनिक संरचना', '{public_infra}', 168)
on conflict (id) do update set name = excluded.name, name_hi = excluded.name_hi,
  categories = excluded.categories, sla_hours = excluded.sla_hours;

-- Demo users: sign in once with email OTP on the web app, then run for example
--   select janseva.set_role('officer@example.com', 'officer', 'hazratganj');
--   select janseva.set_role('admin@example.com', 'admin');
