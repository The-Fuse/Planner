
from fpdf import FPDF
import datetime

class PDF(FPDF):
    def header(self):
        self.set_font('Arial', 'B', 16)
        self.cell(0, 10, 'UPSC Study Planner (Nov-Dec 2025)', 0, 1, 'C')
        self.ln(5)

    def footer(self):
        self.set_y(-15)
        self.set_font('Arial', 'I', 8)
        self.cell(0, 10, f'Page {self.page_no()}', 0, 0, 'C')

def create_pdf(schedule, filename="study_plan.pdf"):
    pdf = PDF(orientation='L', unit='mm', format='A4')
    pdf.add_page()
    pdf.set_font("Arial", size=10)
    
    # Table Config
    # Weekday: Date | Day | Morning | Evening
    # Weekend: Date | Day | Block 1 | Block 2 | Block 3
    
    # We'll use a generic 5-column layout for max flexibility, or switch layouts?
    # Easier to just list the slots dynamically.
    # But user asked for specific columns.
    # "Weekdays Columns: Date | Day | Morning Slot | Evening Slot"
    # "Weekends Columns: Date | Day | Block1 | Block2 | Block3"
    
    # We can iterate and check type of day.
    
    line_height = 8
    
    # Headers
    pdf.set_fill_color(200, 200, 200)
    
    for day in schedule:
        date_str = day['date']
        day_name = day['day']
        is_weekend = day_name in ["Saturday", "Sunday"]
        
        # Check if we need a new page
        if pdf.get_y() > 180:
            pdf.add_page()
            
        pdf.set_font("Arial", 'B', 10)
        
        # Draw Row
        # Calculate max height based on content text wrapping
        # This is tricky in FPDF without MultiCell height calc.
        # We'll assume fixed width and use MultiCell.
        
        # Widths
        w_date = 30
        w_day = 25
        w_content = 220 # Remaining space
        
        x_start = pdf.get_x()
        y_start = pdf.get_y()
        
        # Date & Day
        pdf.cell(w_date, line_height, date_str, 1)
        pdf.cell(w_day, line_height, day_name, 1)
        
        # Slots
        # Construct a single string for the content part or split columns?
        # User asked for specific columns.
        # Weekday: Morning | Evening
        # Weekend: B1 | B2 | B3
        
        # Let's try to fit them.
        if not is_weekend:
            # 2 slots
            w_slot = w_content / 2
            
            slot1 = next((s for s in day['slots'] if s['name'] == 'Morning'), None)
            slot2 = next((s for s in day['slots'] if s['name'] == 'Evening'), None)
            
            txt1 = f"{slot1['subject']}: {slot1['task']}" if slot1 else "-"
            txt2 = f"{slot2['subject']}: {slot2['task']}" if slot2 else "-"
            
            # We need MultiCell for text wrapping, but they need to be side-by-side.
            # Save x,y
            x_curr = pdf.get_x()
            y_curr = pdf.get_y()
            
            # Slot 1
            pdf.set_xy(x_curr, y_start) # Reset to top of row
            pdf.multi_cell(w_slot, line_height, txt1, 1, 'L')
            h1 = pdf.get_y() - y_start
            
            # Slot 2
            pdf.set_xy(x_curr + w_slot, y_start)
            pdf.multi_cell(w_slot, line_height, txt2, 1, 'L')
            h2 = pdf.get_y() - y_start
            
            max_h = max(h1, h2, line_height)
            
            # Reset Y for next row
            pdf.set_y(y_start + max_h)
            
        else:
            # 3 slots
            w_slot = w_content / 3
            
            slot1 = next((s for s in day['slots'] if s['name'] == 'Block 1'), None)
            slot2 = next((s for s in day['slots'] if s['name'] == 'Block 2'), None)
            slot3 = next((s for s in day['slots'] if s['name'] == 'Block 3'), None)
            
            txt1 = f"{slot1['subject']}: {slot1['task']}" if slot1 else "-"
            txt2 = f"{slot2['subject']}: {slot2['task']}" if slot2 else "-"
            txt3 = f"{slot3['subject']}: {slot3['task']}" if slot3 else "-"
            
            x_curr = pdf.get_x()
            
            # Slot 1
            pdf.set_xy(x_curr, y_start)
            pdf.multi_cell(w_slot, line_height, txt1, 1, 'L')
            h1 = pdf.get_y() - y_start
            
            # Slot 2
            pdf.set_xy(x_curr + w_slot, y_start)
            pdf.multi_cell(w_slot, line_height, txt2, 1, 'L')
            h2 = pdf.get_y() - y_start
            
            # Slot 3
            pdf.set_xy(x_curr + 2*w_slot, y_start)
            pdf.multi_cell(w_slot, line_height, txt3, 1, 'L')
            h3 = pdf.get_y() - y_start
            
            max_h = max(h1, h2, h3, line_height)
            pdf.set_y(y_start + max_h)

    pdf.output(filename)

if __name__ == "__main__":
    from scheduler import generate_schedule
    sched = generate_schedule()
    create_pdf(sched)
