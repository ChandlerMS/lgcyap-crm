import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).parent.parent / 'scripts/prepare-svp-dispositions.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MergedCellsTest(unittest.TestCase):
    def test_only_explicit_merged_cells_inherit(self):
        cells = {(4, 0): 'date', (4, 1): 'Agent A', (4, 5): 'note', (6, 1): 'Agent B'}
        module.expand_merges(cells, ['A4:A6', 'B4:B5'])
        self.assertEqual(cells[(5, 0)], 'date')
        self.assertEqual(cells[(6, 0)], 'date')
        self.assertEqual(cells[(5, 1)], 'Agent A')
        self.assertEqual(cells[(6, 1)], 'Agent B')
        self.assertNotIn((5, 5), cells)

    def test_invalid_or_populated_ranges_are_rejected(self):
        with self.assertRaises(ValueError):
            module.expand_merges({(4, 0): 'a', (5, 0): 'b'}, ['A4:A5'])
        with self.assertRaises(ValueError):
            module.expand_merges({}, ['A4:B5'])


if __name__ == '__main__':
    unittest.main()
