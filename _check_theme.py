with open('index.html', 'r', encoding='utf-8') as f:
    text = f.read()
print('theme-icon:', text.count('id="theme-icon"'))
print('theme-toggle:', text.count('id="theme-toggle"'))
