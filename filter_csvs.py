import os, shutil

def filter_file(filepath):
    if not os.path.exists(filepath):
        print(f"Skipped {filepath}")
        return
        
    temp_path = filepath + '.tmp'
    removed = 0
    with open(filepath, 'r', encoding='utf-8', errors='replace') as fin, \
         open(temp_path, 'w', encoding='utf-8') as fout:
        for line in fin:
            l = line.lower()
            if 'hentai' in l or 'henati' in l:
                removed += 1
                continue
            fout.write(line)
            
    shutil.move(temp_path, filepath)
    print(f"Removed {removed} lines from {filepath}")

filter_file('profiles.csv')
filter_file('reviews.csv')
filter_file('animes.csv')
